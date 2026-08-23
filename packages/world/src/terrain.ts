/**
 * Wysokość terenu — warstwa zerowa generacji.
 *
 * `terrainHeight` jest **czystą funkcją współrzędnych świata**. To nie jest
 * kwestia stylu, tylko jedyny sposób, żeby nie mieć szwów na granicach chunków:
 * skoro wysokość nigdy nie pyta o sąsiada, nie da się skonstruować niezgodności
 * między chunkiem a tym, co leży obok.
 *
 * Jednostki: `wx`/`wy` w **komórkach** (jak kamera i siatka spanów), wynik
 * w **metrach**. Komórka ma `CELL_METERS` metrów, więc cecha o skali 600 m to
 * 300 komórek — stąd dziwnie wyglądające dzielniki poniżej.
 */

import { fbm } from './rng.js';

/** Poziom morza w metrach. Wszystko poniżej jest pod wodą. */
export const SEA_LEVEL = 0;

/** komórki na cechę bazową ≈ 600 m przy 2 m na komórkę */
const FEATURE = 300;
/** metry: różnica między dnem doliny a grzbietem w obrębie jednej cechy */
const AMPLITUDE = 44;
/** metry: powolne wypiętrzenie kontynentalne, decyduje o wyżynach i nizinach */
const CONTINENT = 34;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = (x - edge0) / (edge1 - edge0);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Wysokość terenu w metrach.
 *
 * Mieszanka trzech warstw: powolnego wypiętrzenia kontynentalnego, zwykłego fBm
 * na fałdy i szumu grzbietowego (`1 - |2n - 1|`) dołożonego **tylko wysoko**.
 * Ostatni składnik jest ważony wysokością bazową, bo grzbiety mają być ostre
 * w górach i nieobecne na nizinach — jednolite ridged noise daje krajobraz,
 * który wygląda jak zmięty papier na całej mapie.
 */
export function terrainHeight(seed: number, wx: number, wy: number): number {
  const cont = fbm(wx / (FEATURE * 4), wy / (FEATURE * 4), seed + 17, 3);
  const base = fbm(wx / FEATURE, wy / FEATURE, seed, 5);
  const detail = fbm(wx / 55, wy / 55, seed + 31, 3);
  const ridged = 1 - Math.abs(2 * detail - 1);
  // grzbiety wchodzą dopiero tam, gdzie teren i tak jest wysoki
  const ridgeWeight = smoothstep(0.48, 0.82, base);

  return (
    (cont - 0.42) * CONTINENT +
    (base - 0.35) * AMPLITUDE +
    ridged * ridgeWeight * AMPLITUDE * 0.95
  );
}

/**
 * Nachylenie 0..1, gdzie 1 = 45°. Liczone różnicą centralną po 1 komórce.
 *
 * Wersja samodzielna — wygodna w testach i przy pojedynczych zapytaniach, ale
 * kosztuje cztery próbki terenu. Generator chunka liczy nachylenie z gotowego
 * pola wysokości (patrz `chunk.ts`), bo inaczej przekroczyłby budżet 8 ms.
 */
export function terrainSlope(seed: number, wx: number, wy: number): number {
  const e = terrainHeight(seed, wx + 1, wy);
  const w = terrainHeight(seed, wx - 1, wy);
  const n = terrainHeight(seed, wx, wy + 1);
  const s = terrainHeight(seed, wx, wy - 1);
  return slopeFrom(e, w, n, s);
}

/**
 * Nachylenie z czterech sąsiednich wysokości. Dzielimy przez 2 komórki × 2 m,
 * czyli 4 m rozstawu — wynik jest bezwymiarowy (metry na metr).
 */
export function slopeFrom(e: number, w: number, n: number, s: number): number {
  const gx = (e - w) / 4;
  const gy = (n - s) / 4;
  const g = Math.sqrt(gx * gx + gy * gy);
  return g > 1 ? 1 : g;
}
