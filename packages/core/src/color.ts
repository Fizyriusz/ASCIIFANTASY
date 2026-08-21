/**
 * Kolory kwantyzowane do 15 bitów (5-5-5).
 *
 * Powód nie jest estetyczny, tylko wydajnościowy: blit skleja sąsiednie znaki
 * o *identycznym* kolorze w jedno wywołanie fillText. Pełne 24 bity dają serie
 * długości 1 i 10 000 wywołań na klatkę. Kwantyzacja wydłuża serie ~5x przy
 * różnicy koloru niewidocznej na tle blooma.
 */

export type Packed15 = number;

export function pack15(r: number, g: number, b: number): Packed15 {
  const rr = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const gg = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const bb = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return ((rr >> 3) << 10) | ((gg >> 3) << 5) | (bb >> 3);
}

/** Przyciemnia/rozjaśnia kolor bazowy i pakuje. Główna funkcja cieniowania. */
export function shade(r: number, g: number, b: number, f: number): Packed15 {
  return pack15(r * f, g * f, b * f);
}

const cssCache = new Array<string | undefined>(32768);

/** Cache jest krytyczny: bez niego budujemy string na każdy znak. */
export function cssOf(p: Packed15): string {
  const hit = cssCache[p];
  if (hit !== undefined) return hit;
  const r = (((p >> 10) & 31) << 3) | 4;
  const g = (((p >> 5) & 31) << 3) | 4;
  const b = ((p & 31) << 3) | 4;
  const s = `rgb(${r},${g},${b})`;
  cssCache[p] = s;
  return s;
}
