/**
 * Rzeki, jeziora i poziom wody.
 *
 * Problem: rzeka z definicji potrzebuje wiedzy o sąsiedztwie — musi płynąć
 * w dół przez wiele chunków — a chunk nie ma prawa pytać sąsiadów, bo wtedy
 * wynik zależy od kolejności ładowania i dostajemy szew.
 *
 * Rozwiązanie: **warstwa zgrubna**. Szkielet rzeki jest czystą funkcją
 * `(seed, węzeł źródłowy)` — cała polilinia od źródła do morza powstaje w całości
 * albo wcale, niezależnie od tego, który chunk o nią zapytał. Chunk pobiera
 * wyłącznie segmenty przecinające jego prostokąt z marginesem i wcina koryto
 * lokalnie. Dwa sąsiednie chunki liczą tę samą polilinię z tego samego seeda,
 * więc na granicy nie ma czego rozjechać.
 *
 * Pułapka, której to unika: liczenie koryta z *lokalnego* terenu chunka. Segment
 * wchodzący z sąsiada dawałby wtedy uskok dokładnie na krawędzi.
 */

import { h32, mulberry32 } from './rng.js';
import { SEA_LEVEL, terrainHeight } from './terrain.js';

export interface RiverSegment {
  /** początek i koniec w komórkach świata */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** poziom lustra wody w metrach na obu końcach — monotonicznie opada */
  z0: number;
  z1: number;
  /** półszerokość koryta w komórkach */
  half0: number;
  half1: number;
  /**
   * Prostokąt wpływu segmentu, policzony raz przy budowie polilinii.
   * Bez niego każda z ~8 500 próbek chunka liczyłaby rzut i pierwiastek dla
   * każdego segmentu — to była różnica między 13,7 a 5 ms na chunk.
   */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
}

/**
 * Siatka kandydatów na źródła. Gęstość dobrana pomiarem, nie na oko: przy
 * odstępie 384 komórek na 9×9 km wypadało 13 rzek i szansa, że któraś przetnie
 * konkretny chunk, była znikoma — świat wyglądał na całkowicie suchy.
 */
const SOURCE_SPACING = 160;
/** ile węzłów w każdą stronę może dosięgnąć chunka polilinią: ceil(zasięg/odstęp)+1 */
const NODE_REACH = 8;
const SOURCE_CHANCE = 0.55;
/** metry: źródła tylko wyżej — inaczej rzeki startują na plaży */
const SOURCE_MIN_H = 20;
/** komórki na segment */
const STEP = 20;
const MAX_STEPS = 55;
/** metry: o ile lustro wody musi opaść na każdym segmencie */
const MIN_DROP = 0.08;
/** metry: zagłębienie lustra wody względem terenu w miejscu koryta */
const BED_DEPTH = 0.9;
/** komórki: szerokość brzegu, na którym koryto wtapia się w teren */
const BANK = 3.5;

const EMPTY: readonly RiverSegment[] = [];

/** Memoizacja polilinii. Czysty cache — nie zmienia wyniku, tylko koszt. */
const riverCache = new Map<string, readonly RiverSegment[]>();
const CACHE_LIMIT = 4096;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = (x - edge0) / (edge1 - edge0);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Buduje całą rzekę wypływającą z węzła `(nx, ny)` — od źródła do morza albo do
 * wyczerpania kroków. Wynik zależy wyłącznie od `(seed, nx, ny)`, więc każdy
 * chunk widzi identyczną polilinię.
 */
function buildRiver(seed: number, nx: number, ny: number): readonly RiverSegment[] {
  const key = `${seed}:${nx}:${ny}`;
  const hit = riverCache.get(key);
  if (hit !== undefined) return hit;

  const rnd = mulberry32(h32(nx, ny, seed, 0x5217));
  let out: readonly RiverSegment[] = EMPTY;

  if (rnd() <= SOURCE_CHANCE) {
    let x = nx * SOURCE_SPACING + rnd() * SOURCE_SPACING;
    let y = ny * SOURCE_SPACING + rnd() * SOURCE_SPACING;
    const h0 = terrainHeight(seed, x, y);
    if (h0 >= SOURCE_MIN_H) {
      const segs: RiverSegment[] = [];
      let z = h0 - BED_DEPTH;
      // kierunek startowy z gradientu; przy zerowym gradiencie trzymamy poprzedni
      let dx = 0;
      let dy = 1;
      for (let i = 0; i < MAX_STEPS; i++) {
        const e = terrainHeight(seed, x + STEP, y);
        const w = terrainHeight(seed, x - STEP, y);
        const n = terrainHeight(seed, x, y + STEP);
        const s = terrainHeight(seed, x, y - STEP);
        let gx = w - e;
        let gy = s - n;
        const glen = Math.sqrt(gx * gx + gy * gy);
        if (glen > 1e-4) {
          gx /= glen;
          gy /= glen;
          // meander: rzeka idąca dokładnie po gradiencie wygląda jak rynna
          const a = (rnd() - 0.5) * 0.9;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          dx = gx * ca - gy * sa;
          dy = gx * sa + gy * ca;
        }
        const x1 = x + dx * STEP;
        const y1 = y + dy * STEP;
        const h1 = terrainHeight(seed, x1, y1);
        // lustro wody musi opaść na każdym segmencie — to jest cała gwarancja,
        // że rzeka nie popłynie pod górę, i dokładnie to sprawdza test
        const z1 = Math.min(z - MIN_DROP, h1 - BED_DEPTH);
        const half0 = 1.7 + i * 0.09;
        const half1 = 1.7 + (i + 1) * 0.09;
        const pad = half1 + BANK;
        segs.push({
          x0: x,
          y0: y,
          x1,
          y1,
          z0: z,
          z1,
          half0,
          half1,
          bx0: (x < x1 ? x : x1) - pad,
          by0: (y < y1 ? y : y1) - pad,
          bx1: (x > x1 ? x : x1) + pad,
          by1: (y > y1 ? y : y1) + pad,
        });
        x = x1;
        y = y1;
        z = z1;
        if (h1 <= SEA_LEVEL) break; // dopłynęliśmy do morza
      }
      out = segs;
    }
  }

  if (riverCache.size >= CACHE_LIMIT) riverCache.clear();
  riverCache.set(key, out);
  return out;
}

/**
 * Segmenty rzek przecinające chunk `(cx, cy)` powiększony o margines.
 * Margines wynosi jeden chunk, bo koryto wcina się także poza własną komórką.
 */
export function riverSegments(
  seed: number,
  cx: number,
  cy: number,
  chunkSize: number,
): readonly RiverSegment[] {
  const margin = chunkSize;
  const minX = cx * chunkSize - margin;
  const minY = cy * chunkSize - margin;
  const maxX = minX + chunkSize + 2 * margin;
  const maxY = minY + chunkSize + 2 * margin;

  const n0x = Math.floor(minX / SOURCE_SPACING);
  const n0y = Math.floor(minY / SOURCE_SPACING);
  const out: RiverSegment[] = [];

  for (let ny = n0y - NODE_REACH; ny <= n0y + NODE_REACH; ny++) {
    for (let nx = n0x - NODE_REACH; nx <= n0x + NODE_REACH; nx++) {
      const river = buildRiver(seed, nx, ny);
      for (let i = 0; i < river.length; i++) {
        const s = river[i];
        if (s === undefined) continue;
        if (s.bx1 < minX || s.bx0 > maxX || s.by1 < minY || s.by0 > maxY) continue;
        out.push(s);
      }
    }
  }
  return out;
}

/** Najbliższy punkt odcinka: zwraca parametr `t` przycięty do [0,1]. */
function projectT(s: RiverSegment, wx: number, wy: number): number {
  const ex = s.x1 - s.x0;
  const ey = s.y1 - s.y0;
  const len2 = ex * ex + ey * ey;
  if (len2 < 1e-9) return 0;
  const t = ((wx - s.x0) * ex + (wy - s.y0) * ey) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Wysokość terenu po wcięciu koryta. Poza zasięgiem rzek zwraca `raw` bez zmian.
 *
 * Koryto jest wcinane, a nie „malowane": w środku schodzimy do lustra wody minus
 * głębokość, a na brzegu wtapiamy się w teren przez `smoothstep`. Bez tego wtopienia
 * rzeka ma pionowe ściany i wygląda jak rów melioracyjny.
 */
export function carveHeight(
  segs: readonly RiverSegment[],
  wx: number,
  wy: number,
  raw: number,
): number {
  let out = raw;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === undefined) continue;
    if (wx < s.bx0 || wx > s.bx1 || wy < s.by0 || wy > s.by1) continue;
    const t = projectT(s, wx, wy);
    const px = s.x0 + (s.x1 - s.x0) * t;
    const py = s.y0 + (s.y1 - s.y0) * t;
    const d = Math.sqrt((wx - px) * (wx - px) + (wy - py) * (wy - py));
    const half = s.half0 + (s.half1 - s.half0) * t;
    if (d > half + BANK) continue;
    const z = s.z0 + (s.z1 - s.z0) * t;
    const bed = z - BED_DEPTH;
    // 0 na osi koryta, 1 na zewnętrznej krawędzi brzegu
    const k = smoothstep(half, half + BANK, d);
    const carved = bed + (raw - bed) * k;
    if (carved < out) out = carved;
  }
  return out;
}

/**
 * Poziom lustra wody w danym punkcie albo `null`, gdy nie ma tam wody.
 * Uwzględnia rzeki i morze — jeziora powstają tam, gdzie koryto wchodzi
 * w zagłębienie i lustro zostaje powyżej terenu.
 */
export function waterAt(
  segs: readonly RiverSegment[],
  wx: number,
  wy: number,
  ground: number,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === undefined) continue;
    if (wx < s.bx0 || wx > s.bx1 || wy < s.by0 || wy > s.by1) continue;
    const t = projectT(s, wx, wy);
    const px = s.x0 + (s.x1 - s.x0) * t;
    const py = s.y0 + (s.y1 - s.y0) * t;
    const d = Math.sqrt((wx - px) * (wx - px) + (wy - py) * (wy - py));
    const half = s.half0 + (s.half1 - s.half0) * t;
    if (d > half) continue;
    const z = s.z0 + (s.z1 - s.z0) * t;
    if (z > ground && (best === null || z > best)) best = z;
  }
  if (best !== null) return best;
  return ground < SEA_LEVEL ? SEA_LEVEL : null;
}

/**
 * Wersja samodzielna dla testów i pojedynczych zapytań: sama znajduje segmenty
 * dla chunka, w którym leży punkt. W generacji chunka **nie używać** — tam
 * segmenty pobiera się raz na chunk, a nie raz na komórkę.
 */
export function waterLevelAt(
  seed: number,
  wx: number,
  wy: number,
  chunkSize: number,
): number | null {
  const cx = Math.floor(wx / chunkSize);
  const cy = Math.floor(wy / chunkSize);
  const segs = riverSegments(seed, cx, cy, chunkSize);
  const ground = carveHeight(segs, wx, wy, terrainHeight(seed, wx, wy));
  return waterAt(segs, wx, wy, ground);
}

/** Wyłącznie do testów: czyści memoizację polilinii. */
export function clearRiverCache(): void {
  riverCache.clear();
}
