/**
 * Lochy: spany **poniżej terenu w tych samych chunkach**, nie osobna scena.
 *
 * Konsekwencja jest taka, że wejście do jaskini nie ma ekranu ładowania i nie
 * istnieje drugi kod renderujący — kolumna renderera po prostu trafia na inne
 * spany. To jest cały powód, dla którego świat od M0 stoi na spanach.
 *
 * Loch jest czystą funkcją `(seed, poiId)`: cały graf powstaje w całości albo
 * wcale, niezależnie od tego, który chunk o niego zapytał. To ta sama zasada,
 * co przy rzekach w M1 — bez niej dwa sąsiednie chunki wykułyby dwa różne lochy
 * i na granicy zostałby uskok.
 *
 * Ograniczenie pojemności: komórka mieści `MAX_SPANS_PER_CELL` spanów, a jedna
 * kondygnacja lochu zjada dwa (skała pod podłogą i strop do powierzchni). Dlatego
 * **poziomy nie nakładają się w pionie** — graf układa je z przesunięciem w bok,
 * a nie jeden pod drugim. Jest to widoczne w `levelOffset`.
 */

import { h32, mulberry32 } from './rng.js';
import { CELL_METERS } from './types.js';
import { terrainHeight, terrainSlope } from './terrain.js';

/** komórki między kandydatami na loch */
const POI_SPACING = 512;
const POI_CHANCE = 0.45;
/** minimalne nachylenie w miejscu wejścia — jaskinia wchodzi w zbocze, nie w łąkę */
const POI_MIN_SLOPE = 0.22;
/** metry: o ile niżej leży każda kolejna kondygnacja */
const LEVEL_DROP = 7;
/** metry: jak głęboko pod podłogą zaczyna się lite podłoże */
const BEDROCK = 24;
/**
 * Komórki: promień otworu jaskini. Otwór jest **jawny**, a nie emergentny —
 * próba wyprowadzenia go z samego przecięcia stropu ze zboczem dawała albo brak
 * wejścia, albo odsłonięty cały pokój, bo nachylenie terenu w miejscu POI (0,22)
 * daje na przestrzeni komory spadek rzędu trzech metrów, a komora leży pięć
 * metrów pod ziemią.
 */
const MOUTH_LEG1 = 4;
/** komórki: drugie ramię wcięcia, już za zakrętem — wychodzi na otwarty teren */
const MOUTH_LEG2 = 12;
/** komórki: połowa szerokości wcięcia — trzy komórki wystarczą, żeby wejść */
const MOUTH_HALF = 1;
/** komórki: pas skalnego obrzeża po obu stronach wcięcia (punkt orientacyjny) */
const MOUTH_RIM = 1;
/**
 * Metry na komórkę: nachylenie rampy wejściowej i schodów.
 *
 * Liczba nie jest estetyczna, tylko wynika z kolizji gracza: `STEP_UP` w grze
 * to 0,6 m, więc wszystko stromsze da się **zejść, ale nie wyjść**. Loch,
 * z którego nie ma powrotu, jest błędem rozgrywki, a nie trudnością.
 */
const MAX_CLIMB = 0.55;
/** ile razy próbujemy ułożyć loch, zanim przyjmiemy układ z kolizją pionową */
const LAYOUT_TRIES = 8;
/** metry: najcieńsza płyta skalna, jaka może zostać między dwiema pustkami */
const SLAB_MIN = 1.2;
/**
 * Komórki: jak daleko poza geometrię lochu skała jest **lita do spągu**.
 *
 * Bez tego marginesu teren nad lochem zostaje zwykłą dwunastometrową skorupą,
 * a pod nią jest pustka — i promień wypuszczony z korytarza w bok wychodzi pod
 * skorupę sąsiada zamiast trafić w ścianę. Korytarz świeci wtedy dziurami
 * w miejscach, gdzie powinien być kamień.
 */
const ROCK_MARGIN = 6;

export interface DungeonRoom {
  /** lewy dolny róg w komórkach świata */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 = przy powierzchni, rośnie w dół */
  level: number;
  /** metry: podłoga i strop */
  floorZ: number;
  ceilZ: number;
  /** czy wejście do pokoju jest zamknięte na klucz */
  locked: boolean;
  /** czy w pokoju leży klucz do zamkniętej gałęzi */
  hasKey: boolean;
}

export interface DungeonCorridor {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floorZ: number;
  ceilZ: number;
  /** czy korytarz jest schodami — podłoga zmienia wysokość wzdłuż biegu */
  stairs: boolean;
  /**
   * Na ilu komórkach bieg schodów kończy zjazd. Krócej niż długość korytarza,
   * bo jego koniec wpada **w środek** następnej komory, a komora ma jedną,
   * płaską podłogę. Bez tego zapasu na krawędzi komory zostaje próg wysokości
   * połowy komory — zejść po nim można, wejść już nie.
   */
  rampCells: number;
}

export interface DungeonGraph {
  poiId: number;
  /** komórka wejścia — wylot wcięcia w zboczu */
  mouthX: number;
  mouthY: number;
  /** jednostkowy kierunek „na zewnątrz" wzdłuż pierwszego ramienia wcięcia */
  mouthDirX: number;
  mouthDirY: number;
  /**
   * Kierunek drugiego ramienia, prostopadły do pierwszego. Wcięcie **skręca**,
   * i to nie jest ozdoba: proste wcięcie zostawia linię wzroku z wnętrza wprost
   * na oświetlony teren, więc przejście dzień → ciemność dzieje się na dwóch
   * komórkach niezależnie od tego, jak ustawimy tłumienie światła. Zakręt
   * urywa tę linię po kilkunastu metrach i ciemność bierze się z **długości
   * drogi**, a nie ze stromego tłumienia.
   */
  bendX: number;
  bendY: number;
  rooms: readonly DungeonRoom[];
  corridors: readonly DungeonCorridor[];
  /** indeks pokoju z wejściem */
  entrance: number;
  /** indeks pokoju zamkniętego i pokoju z kluczem; -1 gdy loch bez zamka */
  locked: number;
  keyRoom: number;
  /** obwiednia geometrii w komórkach — poza nią loch nie dotyka terenu */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** metry: spąg litej skały, czyli najgłębsza podłoga minus `BEDROCK` */
  baseZ: number;
}

const EMPTY_GRAPH: DungeonGraph = {
  poiId: 0,
  mouthX: 0,
  mouthY: 0,
  mouthDirX: 1,
  mouthDirY: 0,
  bendX: 0,
  bendY: 1,
  rooms: [],
  corridors: [],
  entrance: -1,
  locked: -1,
  keyRoom: -1,
  minX: 0,
  minY: 0,
  maxX: -1,
  maxY: -1,
  baseZ: 0,
};

const cache = new Map<string, DungeonGraph>();
const CACHE_LIMIT = 256;

/** Identyfikator lochu dla węzła siatki POI albo 0, gdy węzeł jest pusty. */
export function dungeonPoiAt(seed: number, nx: number, ny: number): number {
  const rnd = mulberry32(h32(nx, ny, seed, 0x7a11));
  if (rnd() > POI_CHANCE) return 0;
  const x = nx * POI_SPACING + rnd() * POI_SPACING;
  const y = ny * POI_SPACING + rnd() * POI_SPACING;
  if (terrainSlope(seed, x, y) < POI_MIN_SLOPE) return 0;
  return h32(nx, ny, seed, 0x0d15) >>> 0 || 1;
}

/**
 * Buduje cały loch dla węzła. Pokoje układane są łańcuchem: każdy kolejny
 * odchodzi od poprzedniego w losowym kierunku, co kilka pokoi schodzimy piętro
 * niżej. Łańcuch, a nie graf z cyklami, bo test spójności ma być rozstrzygalny,
 * a klucz musi leżeć **przed** zamkiem — w łańcuchu to znaczy „o mniejszym indeksie".
 */
/**
 * Jedna próba ułożenia łańcucha komór. Wydzielona, bo układ bywa **odrzucany**:
 * łańcuch chodzi po siatce i potrafi wrócić nad własny korytarz. Dwie pustki
 * jedna nad drugą bez porządnej płyty skalnej scalają się w jedną (`pushVoid`
 * je łączy) i schody kończą się dziurą w podłodze — gracz spada piętro niżej
 * albo, gorzej, staje na poziomie, z którego nie ma wyjścia.
 */
function buildChain(
  poiId: number,
  mouthX: number,
  mouthY: number,
  floor0: number,
): { rooms: DungeonRoom[]; corridors: DungeonCorridor[] } {
  let best: { rooms: DungeonRoom[]; corridors: DungeonCorridor[] } | null = null;

  for (let salt = 0; salt < LAYOUT_TRIES; salt++) {
    const rnd = mulberry32((poiId ^ 0x51ed) + salt * 0x9e37);
    const rooms: DungeonRoom[] = [];
    const corridors: DungeonCorridor[] = [];
    const count = 6 + Math.floor(rnd() * 5);
    let cx = mouthX;
    let cy = mouthY;
    let level = 0;
    let floorZ = floor0;
    // -1 = brak poprzedniego biegu; 0 = poprzedni szedł wzdłuż X
    let prevAxis = -1;

    // Rozmiary losujemy z góry: korytarz musi znać wymiar **następnej** komory,
    // żeby wiedzieć, gdzie skończyć zjazd, a powstaje przed nią.
    const sizes: Array<[number, number]> = [];
    for (let r = 0; r < count; r++) sizes.push([3 + Math.floor(rnd() * 6), 3 + Math.floor(rnd() * 6)]);

    for (let r = 0; r < count; r++) {
      const size = sizes[r] ?? [3, 3];
      const w = size[0];
      const h = size[1];
      // różne wysokości stropu — bez tego model spanów niczego nie wnosi
      const ceilZ = floorZ + 2.4 + rnd() * 2.6;
      rooms.push({
        x: cx - (w >> 1),
        y: cy - (h >> 1),
        w,
        h,
        level,
        floorZ,
        ceilZ,
        locked: false,
        hasKey: false,
      });

      if (r === count - 1) break;

      // co dwa–trzy pokoje schodzimy piętro niżej; bieg schodów musi być na tyle
      // długi, żeby jego nachylenie zmieściło się w `MAX_CLIMB` — inaczej gracz
      // zejdzie i zostanie na dole
      const descend = r > 0 && r % (2 + (poiId & 1)) === 0 && level < 3;
      // długość liczona z zapasem na połowę następnej komory (maksymalnie 4)
      const minLen = descend ? Math.ceil(LEVEL_DROP / MAX_CLIMB) + 5 : 8;
      // oś na przemian: bieg równoległy do poprzedniego kładłby się na nim
      const axis = prevAxis === 0 ? 1 : 0;
      const sign = rnd() < 0.5 ? 1 : -1;
      const len = minLen + Math.floor(rnd() * 11);
      const px = cx;
      const py = cy;
      if (axis === 0) cx += sign * len;
      else cy += sign * len;
      prevAxis = axis;

      const nextFloor = descend ? floorZ - LEVEL_DROP : floorZ;
      const nextSize = sizes[r + 1] ?? [3, 3];
      const halfNext = axis === 0 ? nextSize[0] >> 1 : nextSize[1] >> 1;
      const ramp = len - halfNext - 1;
      corridors.push({
        x0: px,
        y0: py,
        x1: cx,
        y1: cy,
        floorZ,
        ceilZ: floorZ + 2.3,
        stairs: descend,
        rampCells: ramp > 1 ? ramp : 1,
      });
      if (descend) level++;
      floorZ = nextFloor;
    }

    if (best === null) best = { rooms, corridors };
    if (layoutOk(rooms, corridors)) return { rooms, corridors };
  }

  return best ?? { rooms: [], corridors: [] };
}

/** Prostokąt zajmowany przez korytarz — pas o szerokości trzech komórek. */
function corridorBox(c: DungeonCorridor): [number, number, number, number] {
  const x0 = (c.x0 < c.x1 ? c.x0 : c.x1) - 1;
  const x1 = (c.x0 > c.x1 ? c.x0 : c.x1) + 1;
  const y0 = (c.y0 < c.y1 ? c.y0 : c.y1) - 1;
  const y1 = (c.y0 > c.y1 ? c.y0 : c.y1) + 1;
  return [x0, y0, x1, y1];
}

/**
 * Czy układ nie ma pustek leżących nad sobą bez płyty skalnej między nimi.
 *
 * Poziomy wolno mijać w rzucie z góry — nie wolno im się **stykać w pionie**,
 * bo komórka mieści cztery spany i sąsiadujące pustki i tak by się scaliły.
 */
function layoutOk(rooms: readonly DungeonRoom[], corridors: readonly DungeonCorridor[]): boolean {
  const boxes: Array<[number, number, number, number, number, number]> = [];
  for (const r of rooms) boxes.push([r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, r.floorZ, r.ceilZ]);
  for (const c of corridors) {
    const b = corridorBox(c);
    // bieg schodów zajmuje cały zakres wysokości, przez który schodzi
    const lo = c.stairs ? c.floorZ - LEVEL_DROP : c.floorZ;
    boxes.push([b[0], b[1], b[2], b[3], lo, c.ceilZ]);
  }

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (b === undefined) continue;
      if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      // ten sam poziom to normalne połączenie łańcucha, nie konflikt
      if (Math.abs(a[4] - b[4]) < 0.5) continue;
      const gap = a[4] > b[4] ? a[4] - b[5] : b[4] - a[5];
      if (gap < SLAB_MIN) return false;
    }
  }
  return true;
}

export function dungeonAt(seed: number, nx: number, ny: number): DungeonGraph {
  const key = `${seed}:${nx}:${ny}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const poiId = dungeonPoiAt(seed, nx, ny);
  let out = EMPTY_GRAPH;

  if (poiId !== 0) {
    const rnd = mulberry32(poiId ^ 0x51ed);
    const mouthX = Math.round(nx * POI_SPACING + rnd() * POI_SPACING);
    const mouthY = Math.round(ny * POI_SPACING + rnd() * POI_SPACING);
    const surface = terrainHeight(seed, mouthX, mouthY);

    const attempt = buildChain(poiId, mouthX, mouthY, surface - 5.5);
    const rooms = attempt.rooms;
    const corridors = attempt.corridors;

    // zamek i klucz: zamykamy ostatnią trzecią łańcucha, klucz kładziemy w pokoju
    // o mniejszym indeksie, czyli osiągalnym bez przechodzenia przez zamek
    let locked = -1;
    let keyRoom = -1;
    if (rooms.length >= 4) {
      locked = rooms.length - 1 - Math.floor(rnd() * 2);
      keyRoom = 1 + Math.floor(rnd() * (locked - 1));
      const lr = rooms[locked];
      const kr = rooms[keyRoom];
      if (lr !== undefined) lr.locked = true;
      if (kr !== undefined) kr.hasKey = true;
    }

    let minX = mouthX;
    let minY = mouthY;
    let maxX = mouthX;
    let maxY = mouthY;
    let deepest = rooms[0]?.floorZ ?? surface;
    for (const r of rooms) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
      if (r.floorZ < deepest) deepest = r.floorZ;
    }
    for (const c of corridors) {
      const cx0 = c.x0 < c.x1 ? c.x0 : c.x1;
      const cx1 = c.x0 < c.x1 ? c.x1 : c.x0;
      const cy0 = c.y0 < c.y1 ? c.y0 : c.y1;
      const cy1 = c.y0 < c.y1 ? c.y1 : c.y0;
      if (cx0 < minX) minX = cx0;
      if (cy0 < minY) minY = cy0;
      if (cx1 > maxX) maxX = cx1;
      if (cy1 > maxY) maxY = cy1;
      if (c.floorZ < deepest) deepest = c.floorZ;
    }

    // Wcięcie idzie dokładnie **przeciwnie do pierwszego korytarza**: tunel
    // wchodzi w zbocze w jedną stronę, więc wąwóz musi otwierać się w drugą.
    // Liczenie kierunku ze środka pierwszej komory nie działało — komora jest
    // wyśrodkowana na wylocie i różnica wychodziła zerowa.
    const c0 = corridors[0];
    let mdx = 1;
    let mdy = 0;
    if (c0 !== undefined) {
      mdx = -Math.sign(c0.x1 - c0.x0);
      mdy = -Math.sign(c0.y1 - c0.y0);
      if (mdx === 0 && mdy === 0) mdx = 1;
    }

    // zakręt w lewo albo w prawo — bit poiId, żeby nie wszystkie wejścia
    // wyglądały tak samo
    const bendSign = (poiId & 2) === 0 ? 1 : -1;

    out = {
      poiId,
      mouthX,
      mouthY,
      mouthDirX: mdx,
      mouthDirY: mdy,
      bendX: -mdy * bendSign,
      bendY: mdx * bendSign,
      rooms,
      corridors,
      entrance: 0,
      locked,
      keyRoom,
      minX,
      minY,
      maxX,
      maxY,
      baseZ: bedrockUnder(deepest),
    };
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}

/** Lochy, których geometria może sięgać danego prostokąta komórek. */
export function dungeonsNear(
  seed: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): DungeonGraph[] {
  const out: DungeonGraph[] = [];
  const n0x = Math.floor(minX / POI_SPACING);
  const n0y = Math.floor(minY / POI_SPACING);
  const n1x = Math.floor(maxX / POI_SPACING);
  const n1y = Math.floor(maxY / POI_SPACING);
  for (let ny = n0y - 1; ny <= n1y + 1; ny++) {
    for (let nx = n0x - 1; nx <= n1x + 1; nx++) {
      const g = dungeonAt(seed, nx, ny);
      if (g.rooms.length > 0) out.push(g);
    }
  }
  return out;
}

/**
 * Spąg litej skały w komórce sąsiadującej z lochem albo `fallback` poza jego
 * zasięgiem. Woła się raz na komórkę chunka, więc porównuje tylko obwiednie —
 * pokoje i korytarze są już w nich zawarte.
 */
export function dungeonRockBase(
  graphs: readonly DungeonGraph[],
  wx: number,
  wy: number,
  fallback: number,
): number {
  let out = fallback;
  for (let i = 0; i < graphs.length; i++) {
    const g = graphs[i];
    if (g === undefined || g.rooms.length === 0) continue;
    if (wx < g.minX - ROCK_MARGIN || wx > g.maxX + ROCK_MARGIN) continue;
    if (wy < g.minY - ROCK_MARGIN || wy > g.maxY + ROCK_MARGIN) continue;
    if (g.baseZ < out) out = g.baseZ;
  }
  return out;
}

/**
 * Czy komórka należy do otworu jaskini. Otwór nie ma stropu i wpuszcza światło,
 * a jego podłoga jest rampą schodzącą od powierzchni do pierwszej komory.
 */
/** Wynik rzutowania komórki na łamaną wcięcia. Współdzielony, zerowa alokacja. */
export interface MouthProjection {
  /** droga wzdłuż wcięcia od wylotu tunelu, w komórkach */
  s: number;
  /** odległość w bok od osi wcięcia, w komórkach */
  p: number;
}

const proj: MouthProjection = { s: 0, p: 0 };

/**
 * Rzutuje komórkę na łamaną wcięcia: pierwsze ramię biegnie od wylotu tunelu
 * na zewnątrz, drugie odbija prostopadle. Zwraca `false`, gdy komórka leży poza
 * pasem wpływu wcięcia (szerokość wcięcia plus obrzeże).
 *
 * Jedna funkcja dla trzech pytań — czy to wcięcie, jaka wysokość podłogi, czy to
 * obrzeże — bo wszystkie trzy potrzebują tej samej pary liczb, a liczone są raz
 * na komórkę chunka.
 */
export function mouthProject(
  g: DungeonGraph,
  wx: number,
  wy: number,
  out: MouthProjection,
): boolean {
  const dx = wx - g.mouthX;
  const dy = wy - g.mouthY;
  const limit = MOUTH_HALF + MOUTH_RIM + 0.5;

  const a1 = dx * g.mouthDirX + dy * g.mouthDirY;
  const p1abs = Math.abs(dx * g.bendX + dy * g.bendY);
  const ok1 = a1 >= -0.5 && a1 <= MOUTH_LEG1 && p1abs <= limit;

  // drugie ramię liczone od kolana
  const bx = dx - g.mouthDirX * MOUTH_LEG1;
  const by = dy - g.mouthDirY * MOUTH_LEG1;
  const a2 = bx * g.bendX + by * g.bendY;
  const p2abs = Math.abs(bx * g.mouthDirX + by * g.mouthDirY);
  const ok2 = a2 > 0 && a2 <= MOUTH_LEG2 && p2abs <= limit;

  // Na kolanie oba ramiona zgłaszają tę samą komórkę i wygrywa **bliższe osi**.
  // Kolejność „pierwsze pasujące" dawała tu komórki środka wcięcia zaliczone do
  // obrzeża sąsiedniego ramienia, czyli dziurę w rynnie tuż za zakrętem.
  if (ok1 && (!ok2 || p1abs <= p2abs)) {
    out.s = a1 < 0 ? 0 : a1;
    out.p = p1abs;
    return true;
  }
  if (ok2) {
    out.s = MOUTH_LEG1 + a2;
    out.p = p2abs;
    return true;
  }
  return false;
}

/** Czy komórka leży **w** wcięciu (a nie na jego obrzeżu). */
export function dungeonMouthAt(
  graphs: readonly DungeonGraph[],
  wx: number,
  wy: number,
): DungeonGraph | null {
  for (let i = 0; i < graphs.length; i++) {
    const g = graphs[i];
    if (g === undefined || g.rooms.length === 0) continue;
    if (!mouthProject(g, wx, wy, proj)) continue;
    if (proj.p <= MOUTH_HALF + 0.5) return g;
  }
  return null;
}

/**
 * Czy komórka jest **obrzeżem** wcięcia: pasem tuż obok, który dostaje nagą skałę
 * zamiast darni, a przy samym wylocie także pionowe bryły.
 *
 * To jest punkt orientacyjny, nie dekoracja. Wcięcie oglądane z trzydziestu metrów
 * jest ciemną plamą nieodróżnialną od cienia pod drzewem; jasne obrzeże i kilka
 * brył łamiących linię horyzontu dają sylwetkę, po której da się je znaleźć.
 */
export function dungeonRimAt(
  graphs: readonly DungeonGraph[],
  wx: number,
  wy: number,
  out: MouthProjection,
): DungeonGraph | null {
  for (let i = 0; i < graphs.length; i++) {
    const g = graphs[i];
    if (g === undefined || g.rooms.length === 0) continue;
    if (!mouthProject(g, wx, wy, out)) continue;
    if (out.p > MOUTH_HALF + 0.5) return g;
  }
  return null;
}

/**
 * Wysokość podłogi we wcięciu wejściowym: rampa o stałym nachyleniu `MAX_CLIMB`,
 * od podłogi korytarza w głębi do poziomu terenu na zewnątrz.
 *
 * Wcięcie jest **jawnym wąwozem w zboczu**, a nie lejem: krąg o promieniu dwóch
 * komórek dawał spadek 2,7 m na komórkę, czyli wejście, z którego nie ma wyjścia.
 * Rampa kończy się sama, gdy dogoni teren — dalej to już zwykły grunt.
 */
export function mouthFloor(g: DungeonGraph, wx: number, wy: number, surface: number): number {
  const room = g.rooms[0];
  if (room === undefined) return surface;
  if (!mouthProject(g, wx, wy, proj)) return surface;
  const z = room.floorZ + proj.s * MAX_CLIMB;
  const cap = surface - 0.4;
  return z < cap ? z : cap;
}

/**
 * Głębokość wcięcia w komórce — ile metrów skały jest nad podłogą wąwozu.
 *
 * Steruje ilością nieba, jakie do tej komórki dochodzi: wąskie, głębokie wcięcie
 * widzi pasek nieba, a płytki rów prawie całe. Bez tego cała rynna ma pełne światło
 * dnia i przejście na ciemność tunelu jest schodkiem, a nie zejściem.
 */
export function mouthDepth(g: DungeonGraph, wx: number, wy: number, surface: number): number {
  const d = surface - mouthFloor(g, wx, wy, surface);
  return d > 0 ? d : 0;
}

/** Postęp zjazdu 0..1 po `dist` komórkach biegu o rampie `cells`. */
function rampT(dist: number, cells: number): number {
  const t = dist / cells;
  return t > 1 ? 1 : t;
}

/** Wynik zapytania o pustkę lochu w komórce. */
export interface DungeonVoid {
  floorZ: number;
  ceilZ: number;
  /** czy to komora, czy korytarz — decyduje o materiale podłogi */
  room: boolean;
}

/**
 * Wszystkie pustki lochu w kolumnie, posortowane od najniższej.
 *
 * Kolumna **może** mieć dwie pustki — korytarz poziomu wyżej nad komorą poziomu
 * niżej. Zwracanie tylko pierwszej dawało komórkę bez stropu i z podłogą z innego
 * piętra; to był realny błąd wykryty pomiarem, nie teoretyczny przypadek.
 * Pustki nachodzące na siebie w pionie scalamy, bo dwie pustki bez litej skały
 * między nimi to jedna wysoka pustka.
 *
 * Zwraca liczbę wypełnionych wpisów w `out` (maksymalnie `out.length`).
 */
export function dungeonVoidsAt(
  graphs: readonly DungeonGraph[],
  wx: number,
  wy: number,
  out: DungeonVoid[],
): number {
  let n = 0;
  for (let g = 0; g < graphs.length; g++) {
    const graph = graphs[g];
    if (graph === undefined) continue;
    const rooms = graph.rooms;
    for (let i = 0; i < rooms.length && n < out.length; i++) {
      const r = rooms[i];
      if (r === undefined) continue;
      if (wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h) {
        n = pushVoid(out, n, r.floorZ, r.ceilZ, true);
      }
    }
    const cors = graph.corridors;
    for (let i = 0; i < cors.length && n < out.length; i++) {
      const c = cors[i];
      if (c === undefined) continue;
      if (c.x0 === c.x1) {
        const lo = c.y0 < c.y1 ? c.y0 : c.y1;
        const hi = c.y0 > c.y1 ? c.y0 : c.y1;
        if (wy < lo || wy > hi || wx < c.x0 - 1 || wx > c.x0 + 1) continue;
        const t = hi === lo ? 0 : (wy - lo) / (hi - lo);
        const along = (c.y1 >= c.y0 ? t : 1 - t) * (hi - lo);
        const f = c.stairs ? c.floorZ - LEVEL_DROP * rampT(along, c.rampCells) : c.floorZ;
        n = pushVoid(out, n, f, f + (c.ceilZ - c.floorZ), false);
        continue;
      }
      const lo = c.x0 < c.x1 ? c.x0 : c.x1;
      const hi = c.x0 > c.x1 ? c.x0 : c.x1;
      if (wx < lo || wx > hi || wy < c.y0 - 1 || wy > c.y0 + 1) continue;
      const t = hi === lo ? 0 : (wx - lo) / (hi - lo);
      const along = (c.x1 >= c.x0 ? t : 1 - t) * (hi - lo);
      const f = c.stairs ? c.floorZ - LEVEL_DROP * rampT(along, c.rampCells) : c.floorZ;
      n = pushVoid(out, n, f, f + (c.ceilZ - c.floorZ), false);
    }
  }
  return n;
}

/** Wstawia pustkę zachowując porządek po `floorZ` i scalając nakładające się. */
function pushVoid(
  out: DungeonVoid[],
  n: number,
  floorZ: number,
  ceilZ: number,
  room: boolean,
): number {
  for (let i = 0; i < n; i++) {
    const v = out[i];
    if (v === undefined) continue;
    // pustki stykające się albo nachodzące to w rzeczywistości jedna komora
    if (floorZ <= v.ceilZ + 0.05 && ceilZ + 0.05 >= v.floorZ) {
      if (floorZ < v.floorZ) v.floorZ = floorZ;
      if (ceilZ > v.ceilZ) v.ceilZ = ceilZ;
      v.room = v.room || room;
      return n;
    }
  }
  if (n >= out.length) return n;
  let at = n;
  while (at > 0) {
    const prev = out[at - 1];
    if (prev === undefined || prev.floorZ <= floorZ) break;
    const cur = out[at];
    if (cur === undefined) break;
    cur.floorZ = prev.floorZ;
    cur.ceilZ = prev.ceilZ;
    cur.room = prev.room;
    at--;
  }
  const slot = out[at];
  if (slot === undefined) return n;
  slot.floorZ = floorZ;
  slot.ceilZ = ceilZ;
  slot.room = room;
  return n + 1;
}

/** Metry: dolna granica litego podłoża pod pustką. */
export function bedrockUnder(floorZ: number): number {
  return floorZ - BEDROCK;
}

/** Wyłącznie do testów: czyści memoizację grafów. */
export function clearDungeonCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * Zawartość lochu: mieszkańcy i światło (M3d)
 * ------------------------------------------------------------------ */

/**
 * Byt zamieszkujący komorę. Wynik jest **czystą funkcją `(seed, poiId, indeks komory)`**,
 * a nie stanem zapisanym w chunku — dokładnie z tego samego powodu, dla którego cały
 * graf jest funkcją POI: pozycje w danych chunka zmieniłyby jego hash zawartości,
 * czyli test determinizmu i format zapisu.
 *
 * Świat wyłącznie **proponuje** miejsce. Sprawdzenie, czy sylwetka się w nim mieści,
 * należy do warstwy gry, bo to ona zna kolizję — tutaj nie ma dostępu do spanów.
 */
/**
 * Ile bytów wystawiać w komorach. **Parametr, nie import**: `packages/world` nie może
 * sięgać po wartości z contentu, bo to odwróciłoby kierunek zależności — świat ma
 * deklarować, czego potrzebuje, a paczka contentu to dostarczać. Kształt jest zgodny
 * z `DUNGEON_SPAWN`, więc gra podaje go wprost.
 */
export interface DwellerRules {
  roomChance: number;
  entryRoomChance: number;
  packMin: number;
  packMax: number;
  perLevel: number;
  kind: number;
}

/** Analogicznie dla żagwi; kształt zgodny z `DUNGEON_LIGHT`. */
export interface LightRules {
  roomChance: number;
  perRoomMin: number;
  perRoomMax: number;
  heightM: number;
}

export interface DungeonDweller {
  /** indeks w `graph.rooms` — to jest zarazem pochodzenie bytu w zapisie */
  roomIndex: number;
  /** komórki świata, środek komórki */
  x: number;
  y: number;
  /** metry: podłoga komory */
  z: number;
  /** indeks w `wildCreatures` */
  kind: number;
}

/** Żagiew: nieruchome źródło światła zawieszone nad podłogą komory. */
export interface DungeonLight {
  roomIndex: number;
  /** metry świata — od razu w jednostkach `LightRig`, żeby gra nie przeliczała */
  x: number;
  y: number;
  z: number;
}

/**
 * Mieszkańcy całego lochu. Kolejność jest funkcją indeksu komory, nie kolejności
 * odwiedzania — inaczej ten sam loch dawałby inną obsadę w zależności od tego,
 * którym wejściem gracz do niego trafił.
 */
export function dungeonDwellers(
  seed: number,
  graph: DungeonGraph,
  rules: DwellerRules,
): DungeonDweller[] {
  const out: DungeonDweller[] = [];
  for (let i = 0; i < graph.rooms.length; i++) {
    const room = graph.rooms[i];
    if (room === undefined) continue;
    const rnd = mulberry32(h32(seed ^ 0xd8e1, graph.poiId, i, 1));
    const bazowa = i === graph.entrance ? rules.entryRoomChance : rules.roomChance;
    const szansa = bazowa + room.level * rules.perLevel;
    if (rnd() >= szansa) continue;

    const ilu =
      rules.packMin +
      Math.floor(rnd() * (rules.packMax - rules.packMin + 1));
    for (let n = 0; n < ilu; n++) {
      // wnętrze komory z marginesem jednej komórki od ściany: byt przyklejony
      // do ściany wygląda jak wtopiony w nią, a AI i tak zaraz go z niej wyprowadzi
      const w = Math.max(1, room.w - 2);
      const h = Math.max(1, room.h - 2);
      out.push({
        roomIndex: i,
        x: room.x + 1 + Math.floor(rnd() * w) + 0.5,
        y: room.y + 1 + Math.floor(rnd() * h) + 0.5,
        z: room.floorZ,
        kind: rules.kind,
      });
    }
  }
  return out;
}

/**
 * Żagwie. Osobny strumień losowy od mieszkańców (inna sól), żeby zmiana liczebności
 * potworów nie przestawiała świateł — dwa niezależne pokrętła w contencie mają być
 * naprawdę niezależne.
 *
 * Liczba jest celowo mała: loch ma zostać ciemny, a test ciemności z M2 obowiązuje
 * bez zmiany progów. Żagiew jest wyjątkiem, który tę ciemność podkreśla.
 */
export function dungeonLights(
  seed: number,
  graph: DungeonGraph,
  rules: LightRules,
): DungeonLight[] {
  const out: DungeonLight[] = [];
  for (let i = 0; i < graph.rooms.length; i++) {
    const room = graph.rooms[i];
    if (room === undefined) continue;
    const rnd = mulberry32(h32(seed ^ 0x11a7, graph.poiId, i, 2));
    if (rnd() >= rules.roomChance) continue;

    const ile =
      rules.perRoomMin +
      Math.floor(rnd() * (rules.perRoomMax - rules.perRoomMin + 1));
    for (let n = 0; n < ile; n++) {
      const w = Math.max(1, room.w - 2);
      const h = Math.max(1, room.h - 2);
      const cx = room.x + 1 + Math.floor(rnd() * w) + 0.5;
      const cy = room.y + 1 + Math.floor(rnd() * h) + 0.5;
      // wysokość zawieszenia liczona od podłogi, ale nie wyżej niż pod stropem
      const z = Math.min(room.floorZ + rules.heightM, room.ceilZ - 0.3);
      out.push({ roomIndex: i, x: cx * CELL_METERS, y: cy * CELL_METERS, z });
    }
  }
  return out;
}
