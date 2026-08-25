/**
 * Generacja chunka: teren → woda → biom → roślinność → budowle → loch → światło.
 *
 * Układ pamięci to tablice równoległe, a nie `Cell[]` ze spanami jako obiektami.
 * Powód jest ten sam co w `SpanGrid`: renderer czyta te dane kilkanaście tysięcy
 * razy na klatkę, a `Chunk` z obiektem na komórkę oznacza pogoń za wskaźnikami
 * i pracę dla GC przy każdym wejściu do pierścienia.
 *
 * Kolejność warstw jest istotna i wynika z `docs/architektura.md` §2.2: wysokość
 * nie wie nic o wodzie, woda nie wie nic o biomie, biom nie wie nic o drzewach.
 * Warstwa N czyta wynik N−1 i nigdy odwrotnie.
 *
 * Wysokości liczymy z marginesem jednej komórki, bo nachylenie potrzebuje
 * sąsiadów — i **to jest jedyny sposób**, żeby nachylenie przy krawędzi chunka
 * było takie samo, jak policzone z drugiej strony granicy.
 */

import type { ContentPack } from '@rpg/content';
import { CELL_METERS, CHUNK_SIZE, SpanFlags } from './types.js';
import { MAX_SPANS_PER_CELL } from './grid.js';
import { h32 } from './rng.js';
import { slopeFrom, terrainHeight } from './terrain.js';
import type { RiverSegment } from './hydro.js';
import { carveHeight, riverSegments, waterAt } from './hydro.js';
import { classifyBiome } from './biome.js';
import type { PropPick } from './props.js';
import { propAt } from './props.js';
import type { DungeonGraph, DungeonVoid } from './dungeon.js';
import {
  bedrockUnder,
  dungeonMouthAt,
  dungeonRockBase,
  dungeonVoidsAt,
  dungeonsNear,
  mouthFloor,
} from './dungeon.js';
import type { Structure, StructureHit } from './structure.js';
import { StructurePart, structureAtCell, structuresNear } from './structure.js';

const CELLS = CHUNK_SIZE * CHUNK_SIZE;
const SLOTS = CELLS * MAX_SPANS_PER_CELL;
/** margines 1 komórki z każdej strony — pod nachylenie */
const STRIDE = CHUNK_SIZE + 2;

/** metry: jak głęboko pod powierzchnię sięga span gruntu */
const SUBSTRATE = 12;
/**
 * Metry: najcieńszy strop skalny, jaki jeszcze zostawiamy nad pustką. Poniżej
 * tego strop znika i powstaje otwór jaskini — dzięki temu wejście do lochu robi
 * się samo tam, gdzie komora podchodzi pod zbocze, i nie trzeba go stawiać ręcznie.
 */
const ROOF_MIN = 0.6;

/**
 * Margines pola światła. Musi wynosić `15 / ATTENUATION`, czyli tyle komórek,
 * ile światło potrzebuje, żeby zgasnąć — inaczej komórka przy krawędzi chunka
 * dostałaby inną wartość niż ta sama komórka policzona z drugiej strony granicy.
 */
const LIGHT_MARGIN = 3;
/**
 * Ile światła gubi komórka pustki. Trójka dawała dziesięć metrów dziennego
 * światła w głąb tunelu — tyle, że wejście do jaskini wyglądało jak korytarz
 * z oświetleniem. Piątka gasi je po sześciu metrach i dopiero wtedy przejście
 * powierzchnia → podziemie jest widoczne w jednym kadrze.
 */
const ATTENUATION = 5;
const LIGHT_STRIDE = CHUNK_SIZE + 2 * LIGHT_MARGIN;

/**
 * Chunk w postaci, w jakiej trzyma go pamięć i czyta renderer.
 * Wszystkie tablice są indeksowane `cellIndex = ly * CHUNK_SIZE + lx`.
 */
export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly counts = new Uint8Array(CELLS);
  readonly bottoms = new Float32Array(SLOTS);
  readonly tops = new Float32Array(SLOTS);
  readonly mats = new Uint16Array(SLOTS);
  readonly capMats = new Uint16Array(SLOTS);
  readonly spanFlags = new Uint8Array(SLOTS);
  readonly lights = new Uint8Array(CELLS);
  readonly biomes = new Uint8Array(CELLS);
  /** hash zawartości — podstawa testu determinizmu */
  contentHash = 0;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
  }
}

/** Bufory robocze wspólne dla wszystkich wywołań — generacja też ma nie śmiecić. */
const heightField = new Float32Array(STRIDE * STRIDE);
const lightField = new Uint8Array(LIGHT_STRIDE * LIGHT_STRIDE);
const kindField = new Uint8Array(LIGHT_STRIDE * LIGHT_STRIDE);
const pick: PropPick = { def: 0, height: 0, trunkTop: 0 };
const nearSegs: RiverSegment[] = [];
/**
 * Pustki lochu w jednej kolumnie. Dwie, bo tyle mieści się w budżecie spanów:
 * lite podłoże, przegroda między piętrami i strop do powierzchni to już trzy
 * spany z czterech dostępnych.
 */
const caves: DungeonVoid[] = [
  { floorZ: 0, ceilZ: 0, room: false },
  { floorZ: 0, ceilZ: 0, room: false },
];
const hut: StructureHit = {
  part: StructurePart.None,
  floorZ: 0,
  wallTop: 0,
  roofTop: 0,
  sill: 0,
  head: 0,
};

/**
 * Odsiewa segmenty, które w ogóle mogą dotknąć tego chunka. Bez tego kroku
 * każda komórka iterowałaby po wszystkich rzekach regionu, co jest różnicą
 * między 2 a 20 ms na chunk.
 */
function collectNear(segs: readonly RiverSegment[], minX: number, minY: number): void {
  nearSegs.length = 0;
  const maxX = minX + CHUNK_SIZE;
  const maxY = minY + CHUNK_SIZE;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === undefined) continue;
    if (s.bx1 < minX || s.bx0 > maxX || s.by1 < minY || s.by0 > maxY) continue;
    nearSegs.push(s);
  }
}

/** Rodzaj komórki z punktu widzenia światła. */
const CELL_SOLID = 0;
/** pustka pod stropem — przewodzi światło i sama go nie ma */
const CELL_VOID = 1;
/** pustka otwarta na niebo: otwór jaskini, drzwi, okno — źródło światła dla lochu */
const CELL_OPENING = 2;

/**
 * Klasyfikuje komórkę dla pola światła podziemnego.
 *
 * Liczona z czystych funkcji, nie ze spanów, bo pole obejmuje margines poza
 * chunkiem — a czytanie spanów sąsiada to dokładnie ta zależność od kolejności
 * ładowania, która psuje determinizm.
 */
function lightKind(
  seed: number,
  wx: number,
  wy: number,
  graphs: readonly DungeonGraph[],
  structs: readonly Structure[],
): number {
  if (structureAtCell(structs, wx, wy, hut)) {
    if (hut.part === StructurePart.Door || hut.part === StructurePart.Window) return CELL_OPENING;
    if (hut.part === StructurePart.Interior) return CELL_VOID;
    return CELL_SOLID;
  }
  if (dungeonMouthAt(graphs, wx, wy) !== null) return CELL_OPENING;
  if (dungeonVoidsAt(graphs, wx, wy, caves) > 0) return CELL_VOID;
  return CELL_SOLID;
}

/**
 * Światło **podziemne**: 15 w otworach, 0 głęboko pod stropem, tłumienie 3 na
 * komórkę pustki.
 *
 * Dwie rzeczy są tu nieoczywiste i obie wynikły z pomiaru, nie z projektu.
 *
 * Po pierwsze, światło przewodzą **wyłącznie pustki**. Pierwsza wersja pola
 * traktowała litą skałę obok korytarza jak „teren pod otwartym niebem" i światło
 * przeciekało przez ścianę — korytarz szesnaście metrów pod ziemią dostawał 9
 * zamiast 0. Skała jest teraz barierą, a nie źródłem.
 *
 * Po drugie, propagacja jest ograniczona do chunka z marginesem, a wartości
 * brzegowe liczone z tych samych czystych funkcji co geometria — nigdy z sąsiada.
 * Bez tego flood fill zależałby od kolejności ładowania i ta sama jaskinia
 * świeciłaby inaczej przy każdym wejściu.
 */
function computeLight(
  seed: number,
  baseX: number,
  baseY: number,
  graphs: readonly DungeonGraph[],
  structs: readonly Structure[],
): void {
  for (let j = 0; j < LIGHT_STRIDE; j++) {
    const wy = baseY + j - LIGHT_MARGIN;
    for (let i = 0; i < LIGHT_STRIDE; i++) {
      const wx = baseX + i - LIGHT_MARGIN;
      const kind = lightKind(seed, wx, wy, graphs, structs);
      const k = j * LIGHT_STRIDE + i;
      kindField[k] = kind;
      lightField[k] = kind === CELL_OPENING ? 15 : 0;
    }
  }
  for (let j = 1; j < LIGHT_STRIDE; j++) {
    for (let i = 1; i < LIGHT_STRIDE; i++) {
      const k = j * LIGHT_STRIDE + i;
      if (kindField[k] === CELL_SOLID) continue;
      const v = lightField[k] ?? 0;
      const a = (lightField[k - 1] ?? 0) - ATTENUATION;
      const b = (lightField[k - LIGHT_STRIDE] ?? 0) - ATTENUATION;
      const best = a > b ? a : b;
      if (best > v) lightField[k] = best;
    }
  }
  for (let j = LIGHT_STRIDE - 2; j >= 0; j--) {
    for (let i = LIGHT_STRIDE - 2; i >= 0; i--) {
      const k = j * LIGHT_STRIDE + i;
      if (kindField[k] === CELL_SOLID) continue;
      const v = lightField[k] ?? 0;
      const a = (lightField[k + 1] ?? 0) - ATTENUATION;
      const b = (lightField[k + LIGHT_STRIDE] ?? 0) - ATTENUATION;
      const best = a > b ? a : b;
      if (best > v) lightField[k] = best;
    }
  }
}

/**
 * Buduje chunk `(cx, cy)` dla danego seeda i paczki settingu.
 * Czysta funkcja: te same argumenty zawsze dają ten sam `contentHash`.
 */
export function generateChunk(seed: number, cx: number, cy: number, pack: ContentPack): Chunk {
  const chunk = new Chunk(cx, cy);
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;

  const segs = riverSegments(seed, cx, cy, CHUNK_SIZE);
  collectNear(segs, baseX, baseY);
  const graphs = dungeonsNear(seed, baseX - LIGHT_MARGIN, baseY - LIGHT_MARGIN,
    baseX + CHUNK_SIZE + LIGHT_MARGIN, baseY + CHUNK_SIZE + LIGHT_MARGIN);
  const structs = structuresNear(seed, baseX - LIGHT_MARGIN, baseY - LIGHT_MARGIN,
    baseX + CHUNK_SIZE + LIGHT_MARGIN, baseY + CHUNK_SIZE + LIGHT_MARGIN);

  // 1. pole wysokości z marginesem, od razu z wciętym korytem
  for (let j = 0; j < STRIDE; j++) {
    const wy = baseY + j - 1;
    for (let i = 0; i < STRIDE; i++) {
      const wx = baseX + i - 1;
      const raw = terrainHeight(seed, wx, wy);
      heightField[j * STRIDE + i] = carveHeight(nearSegs, wx, wy, raw);
    }
  }

  computeLight(seed, baseX, baseY, graphs, structs);

  const waterMat = pack.waterMaterial;
  const M = pack.underground;
  let hash = h32(seed, cx, cy, 0x1c37);

  // 2. komórka po komórce: nachylenie, woda, biom, spany
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const fi = (ly + 1) * STRIDE + (lx + 1);
      const h = heightField[fi] ?? 0;
      const slope = slopeFrom(
        heightField[fi + 1] ?? h,
        heightField[fi - 1] ?? h,
        heightField[fi + STRIDE] ?? h,
        heightField[fi - STRIDE] ?? h,
      );
      const wx = baseX + lx;
      const wy = baseY + ly;
      const water = waterAt(nearSegs, wx, wy, h);
      const biomeId = classifyBiome(seed, wx, wy, h, slope, water);
      const biome = pack.biomes[biomeId];

      const cell = ly * CHUNK_SIZE + lx;
      const base = cell * MAX_SPANS_PER_CELL;
      let n = 0;

      if (structureAtCell(structs, wx, wy, hut)) {
        // --- chata: podłoga, ściany, otwory ---
        if (hut.part === StructurePart.Wall) {
          chunk.bottoms[base] = h - SUBSTRATE;
          chunk.tops[base] = hut.roofTop;
          chunk.mats[base] = M.wall;
          chunk.capMats[base] = M.wall;
          chunk.spanFlags[base] = SpanFlags.Solid;
          n = 1;
        } else if (hut.part === StructurePart.Interior) {
          chunk.bottoms[base] = h - SUBSTRATE;
          chunk.tops[base] = hut.floorZ;
          chunk.mats[base] = M.wall;
          chunk.capMats[base] = M.floor;
          chunk.spanFlags[base] = SpanFlags.Solid;
          chunk.bottoms[base + 1] = hut.wallTop;
          chunk.tops[base + 1] = hut.roofTop;
          chunk.mats[base + 1] = M.wall;
          chunk.capMats[base + 1] = M.wall;
          chunk.spanFlags[base + 1] = SpanFlags.Solid;
          n = 2;
        } else {
          // drzwi albo okno: próg / mur pod parapetem, otwór, nadproże
          const opening = hut.part === StructurePart.Door ? M.doorway : M.window;
          const flag = hut.part === StructurePart.Door ? SpanFlags.Door : SpanFlags.Transparent;
          chunk.bottoms[base] = h - SUBSTRATE;
          chunk.tops[base] = hut.sill;
          chunk.mats[base] = M.wall;
          chunk.capMats[base] = M.floor;
          chunk.spanFlags[base] = SpanFlags.Solid;
          chunk.bottoms[base + 1] = hut.sill;
          chunk.tops[base + 1] = hut.head;
          chunk.mats[base + 1] = opening;
          chunk.capMats[base + 1] = opening;
          chunk.spanFlags[base + 1] = flag | SpanFlags.Transparent;
          chunk.bottoms[base + 2] = hut.head;
          chunk.tops[base + 2] = hut.roofTop;
          chunk.mats[base + 2] = M.wall;
          chunk.capMats[base + 2] = M.wall;
          chunk.spanFlags[base + 2] = SpanFlags.Solid;
          n = 3;
        }
      } else if (dungeonMouthAt(graphs, wx, wy) !== null) {
        // --- otwór jaskini: rampa w dół, bez stropu, otwarty na niebo ---
        const g = dungeonMouthAt(graphs, wx, wy);
        const floorZ = g === null ? h : mouthFloor(g, wx, wy, h);
        chunk.bottoms[base] = bedrockUnder(floorZ);
        chunk.tops[base] = floorZ;
        chunk.mats[base] = M.rock;
        chunk.capMats[base] = M.rubble;
        chunk.spanFlags[base] = SpanFlags.Solid;
        n = 1;
      } else if (dungeonVoidsAt(graphs, wx, wy, caves) > 0) {
        // --- loch: lite podłoże, przegrody między piętrami, strop do powierzchni ---
        const nv = dungeonVoidsAt(graphs, wx, wy, caves);
        const first = caves[0];
        if (first !== undefined) {
          chunk.bottoms[base] = bedrockUnder(first.floorZ);
          chunk.tops[base] = first.floorZ;
          chunk.mats[base] = M.rock;
          chunk.capMats[base] = first.room ? M.rubble : M.rock;
          chunk.spanFlags[base] = SpanFlags.Solid;
          n = 1;
        }
        for (let v = 1; v < nv && n < MAX_SPANS_PER_CELL - 1; v++) {
          const below = caves[v - 1];
          const above = caves[v];
          if (below === undefined || above === undefined) continue;
          chunk.bottoms[base + n] = below.ceilZ;
          chunk.tops[base + n] = above.floorZ;
          chunk.mats[base + n] = M.rock;
          chunk.capMats[base + n] = above.room ? M.rubble : M.rock;
          chunk.spanFlags[base + n] = SpanFlags.Solid;
          n++;
        }
        const topVoid = caves[nv - 1];
        if (topVoid !== undefined && n < MAX_SPANS_PER_CELL) {
          // strop zostaje tylko wtedy, gdy jest z czego go zrobić; cieńszy niż
          // ROOF_MIN znika i w tym miejscu jaskinia otwiera się na zbocze
          const roofBottom = topVoid.ceilZ < h - ROOF_MIN ? topVoid.ceilZ : h - ROOF_MIN;
          if (roofBottom > (chunk.tops[base + n - 1] ?? 0) + 0.1) {
            chunk.bottoms[base + n] = roofBottom;
            chunk.tops[base + n] = h;
            chunk.mats[base + n] = M.rock;
            chunk.capMats[base + n] = biome?.ground ?? 0;
            chunk.spanFlags[base + n] = SpanFlags.Solid;
            n++;
          }
        }
      } else {
        // --- teren otwarty ---
        // Skorupa terenu ma stałą grubość, ale wokół lochu schodzi do spągu:
        // inaczej pod nią zostaje pustka, przez którą widać loch od spodu.
        chunk.bottoms[base] = dungeonRockBase(graphs, wx, wy, h - SUBSTRATE);
        chunk.tops[base] = h;
        chunk.mats[base] = biome?.cliff ?? 0;
        chunk.capMats[base] = biome?.ground ?? 0;
        chunk.spanFlags[base] = SpanFlags.Solid;
        n = 1;

        if (water !== null && water > h) {
          chunk.bottoms[base + n] = h;
          chunk.tops[base + n] = water;
          chunk.mats[base + n] = waterMat;
          chunk.capMats[base + n] = waterMat;
          chunk.spanFlags[base + n] = SpanFlags.Water;
          n++;
        } else if (biome !== undefined && propAt(seed, wx, wy, biome, pack.props, slope, pick)) {
          const def = pack.props[pick.def];
          if (def !== undefined) {
            if (def.kind === 'tree' && n + 1 < MAX_SPANS_PER_CELL) {
              chunk.bottoms[base + n] = h;
              chunk.tops[base + n] = h + pick.trunkTop;
              chunk.mats[base + n] = def.trunkMat;
              chunk.capMats[base + n] = def.trunkMat;
              chunk.spanFlags[base + n] = SpanFlags.Solid;
              n++;
              chunk.bottoms[base + n] = h + pick.trunkTop;
              chunk.tops[base + n] = h + pick.height;
              chunk.mats[base + n] = def.crownMat;
              chunk.capMats[base + n] = def.crownMat;
              chunk.spanFlags[base + n] = SpanFlags.Solid;
              n++;
            } else {
              chunk.bottoms[base + n] = h;
              chunk.tops[base + n] = h + pick.height;
              chunk.mats[base + n] = def.trunkMat;
              chunk.capMats[base + n] = def.crownMat;
              chunk.spanFlags[base + n] = SpanFlags.Solid;
              n++;
            }
          }
        }
      }

      chunk.counts[cell] = n;
      chunk.biomes[cell] = biomeId;
      // Jedna komórka opisuje dwa światy naraz i dlatego bajt światła ma dwie
      // połówki. Starsza to **światło powierzchni** — biom, czyli cień koron.
      // Młodsza to **przepustowość pustki**: ile światła dnia dociera do wnętrza
      // tej komórki korytarzem albo drzwiami. Renderer mnoży je przez siebie
      // (bierze minimum) dopiero wtedy, gdy oko jest pod stropem.
      //
      // Komórka bez pustki dostaje 15, a nie 0. Zero znaczyłoby „nic tu nie
      // dochodzi", a lita skała i otwarty teren po prostu nie mają wnętrza —
      // i ta sama liczba jest czytana dla licowania ściany z sąsiedniej komórki.
      // Zero dałoby czarny klif w południe i czarne pnie w lesie.
      //
      // Wartość „czysta" 0..15 (np. z SpanGrid paczki neon) czyta się dalej
      // poprawnie: starsza połówka wychodzi zerem, renderer bierze młodszą,
      // a minimum z samą sobą nic nie zmienia.
      const lk = (ly + LIGHT_MARGIN) * LIGHT_STRIDE + (lx + LIGHT_MARGIN);
      const under = kindField[lk] === CELL_SOLID ? 15 : (lightField[lk] ?? 0);
      chunk.lights[cell] = ((biome?.light ?? 15) << 4) | under;

      // hash liczony z zaokrąglonych wartości — Float32 jest deterministyczny,
      // ale zaokrąglenie do centymetrów czyni test odpornym na kosmetyczne zmiany
      hash = h32(hash, (h * 100) | 0, biomeId * 8 + n, ((water ?? -999) * 100) | 0);
      hash = h32(hash, chunk.lights[cell] ?? 0, chunk.mats[base] ?? 0, 0);
    }
  }

  chunk.contentHash = hash >>> 0;
  return chunk;
}

/** Metry na komórkę — reeksport dla narzędzi liczących odległości w chunkach. */
export { CELL_METERS, CHUNK_SIZE };
