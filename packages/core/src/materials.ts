/**
 * Materiały zamiast tekstur.
 *
 * W rendererze znakowym nie ma bitmap — o wyglądzie powierzchni decyduje para
 * (rampa glifów, kolor bazowy), a "detal" powstaje z hasha pozycji świata.
 * Dzięki temu ściana ma strukturę, a nie jednolitą plamę, i nie kosztuje to
 * ani jednego bajtu pamięci tekstur.
 *
 * Hash liczymy z **współrzędnych świata**, nigdy ekranu. To nie jest detal
 * estetyczny: przy hashu z pozycji na ekranie tekstura płynie po fasadzie przy
 * każdym kroku gracza i wygląda jak błąd renderowania, którym jest.
 */

import { h32 } from './hash.js';

export interface Material {
  glyphsBright: readonly number[];
  glyphsMid: readonly number[];
  glyphsDark: readonly number[];
  r: number;
  g: number;
  b: number;
  /** 0..1 — jak często hash wybiera glif inny niż podstawowy dla danego pasma */
  roughness: number;
  /** 0..1 — ile powierzchnia świeci własnym światłem, niezależnie od oświetlenia */
  emissive: number;
}

/**
 * Indeksy do MATERIALS. Świat trzyma w spanach `MaterialId` (number), więc to
 * jest wyłącznie wygoda przy budowaniu treści — renderer indeksuje liczbą.
 *
 * Obiekt `as const`, nie `const enum`: ten drugi znika przy transpilacji per
 * plik i jego użycie przez granicę pakietu zależy od bundlera.
 */
export const Mat = {
  Stone: 0,
  Plaster: 1,
  Glass: 2,
  Asphalt: 3,
  Pavement: 4,
  Grass: 5,
  Water: 6,
  Wood: 7,
  Metal: 8,
  Lamp: 9,
} as const;

/** Jeden z indeksów materiału. */
export type Mat = (typeof Mat)[keyof typeof Mat];

function codes(s: string): readonly number[] {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function material(
  bright: string,
  mid: string,
  dark: string,
  r: number,
  g: number,
  b: number,
  roughness: number,
  emissive: number,
): Material {
  return {
    glyphsBright: codes(bright),
    glyphsMid: codes(mid),
    glyphsDark: codes(dark),
    r,
    g,
    b,
    roughness,
    emissive,
  };
}

/**
 * Tablica materiałów, indeksowana przez MaterialId. Kolejność musi się zgadzać
 * z enumem `Mat` — indeks jest kontraktem, bo świat zapisuje go w spanie.
 */
export const MATERIALS: readonly Material[] = [
  /* Stone    */ material('#%&', '=+*', ':.', 150, 150, 160, 0.75, 0),
  /* Plaster  */ material('8OB', 'o=-', '.,', 205, 195, 170, 0.55, 0),
  /* Glass    */ material('#=|', '|:-', '.', 120, 190, 220, 0.35, 0.15),
  /* Asphalt  */ material('=-', '-:', '.', 74, 74, 82, 0.6, 0),
  /* Pavement */ material('##=', '::-', '.', 124, 124, 132, 0.5, 0),
  /* Grass    */ material('"w%', ',v:', '.', 74, 148, 74, 0.9, 0),
  /* Water    */ material('~-', '~:', '.', 60, 120, 200, 0.8, 0.05),
  /* Wood     */ material('HB#', '=+-', ':.', 142, 96, 56, 0.65, 0),
  /* Metal    */ material('M8#', '#=-', ':.', 170, 175, 185, 0.45, 0),
  /* Lamp     */ material('*@', '+o', '.', 255, 220, 140, 0.3, 1),
];

/**
 * Luminancja → pasmo → hash pozycji świata → konkretny glif.
 *
 * `roughness` steruje wyłącznie tym, jak często schodzimy z glifu podstawowego:
 * gładki tynk ma być gładki, a trawa ma migotać. Nie mieszamy tu oświetlenia —
 * ono jest już w `lum`.
 */
export function materialGlyph(
  m: Material,
  lum: number,
  hx: number,
  hy: number,
  hz: number,
): number {
  const ramp = lum >= 0.62 ? m.glyphsBright : lum >= 0.26 ? m.glyphsMid : m.glyphsDark;
  const len = ramp.length;
  if (len === 0) return 32;
  const h = h32(hx, hy, hz, 0);
  // dolne 16 bitów decyduje "czy szum", górne "który glif" — jeden hash, dwa użycia
  const noise = (h & 0xffff) * 0.0000152587890625;
  const idx = noise < m.roughness ? (h >>> 16) % len : 0;
  return ramp[idx] ?? 32;
}
