/**
 * Generacja chunka: teren → woda → biom → roślinność → spany.
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

const CELLS = CHUNK_SIZE * CHUNK_SIZE;
const SLOTS = CELLS * MAX_SPANS_PER_CELL;
/** margines 1 komórki z każdej strony — pod nachylenie */
const STRIDE = CHUNK_SIZE + 2;

/** metry: jak głęboko pod powierzchnię sięga span gruntu */
const SUBSTRATE = 12;

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
const pick: PropPick = { def: 0, height: 0, trunkTop: 0 };
const nearSegs: RiverSegment[] = [];

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

  // 1. pole wysokości z marginesem, od razu z wciętym korytem
  for (let j = 0; j < STRIDE; j++) {
    const wy = baseY + j - 1;
    for (let i = 0; i < STRIDE; i++) {
      const wx = baseX + i - 1;
      const raw = terrainHeight(seed, wx, wy);
      heightField[j * STRIDE + i] = carveHeight(nearSegs, wx, wy, raw);
    }
  }

  const waterMat = pack.waterMaterial;
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

      // grunt — zawsze pierwszy span, od którego zaczyna się kolumna
      chunk.bottoms[base] = h - SUBSTRATE;
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

      chunk.counts[cell] = n;
      chunk.biomes[cell] = biomeId;
      chunk.lights[cell] = biome?.light ?? 15;

      // hash liczony z zaokrąglonych wartości — Float32 jest deterministyczny,
      // ale zaokrąglenie do centymetrów czyni test odpornym na kosmetyczne zmiany
      hash = h32(hash, (h * 100) | 0, biomeId * 8 + n, ((water ?? -999) * 100) | 0);
    }
  }

  chunk.contentHash = hash >>> 0;
  return chunk;
}

/** Metry na komórkę — reeksport dla narzędzi liczących odległości w chunkach. */
export { CELL_METERS, CHUNK_SIZE };
