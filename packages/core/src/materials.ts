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
 *
 * Same dane materiałów mieszkają w `@rpg/content` — tutaj jest wyłącznie ich
 * kompilacja do postaci wygodnej dla hot pathu (stringi glifów → tablice kodów).
 * Kierunek zależności: `core` czyta `content`, nigdy odwrotnie.
 */

import type { MaterialDef } from '@rpg/content';
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

function codes(s: string): readonly number[] {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Zamienia definicje z paczki settingu na tablicę materiałów renderera.
 * Wołane raz przy starcie sceny — indeks w wyniku odpowiada indeksowi w paczce,
 * bo to właśnie ten indeks świat zapisuje w spanie.
 */
export function compileMaterials(defs: readonly MaterialDef[]): Material[] {
  const out = new Array<Material>(defs.length);
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (d === undefined) continue;
    out[i] = {
      glyphsBright: codes(d.bright),
      glyphsMid: codes(d.mid),
      glyphsDark: codes(d.dark),
      r: d.r,
      g: d.g,
      b: d.b,
      roughness: d.roughness,
      emissive: d.emissive,
    };
  }
  return out;
}

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
