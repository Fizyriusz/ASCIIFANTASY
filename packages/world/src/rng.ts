/**
 * Deterministyczne źródła losowości. W packages/world nie wolno użyć Math.random()
 * — cały świat musi być odtwarzalny z seeda, bo zapis gry to seed + delty.
 * Zasada jest sprawdzana testem (rng.test.ts).
 *
 * Sam `h32` mieszka w `@rpg/core/hash` — renderer też go potrzebuje do doboru
 * glifu, a `core` leży niżej w łańcuchu zależności. Tutaj jest reeksportowany,
 * żeby kod generacji świata miał jedno miejsce, z którego bierze losowość.
 */

import { h32 } from '@rpg/core';

export { h32 };

/** Hash → 0..1. Bezstanowy: ta sama pozycja zawsze daje tę samą wartość. */
export function rnd01(a: number, b: number, c: number, d: number): number {
  return h32(a, b, c, d) / 4294967296;
}

/** Generator stanowy — do sekwencji, gdzie kolejność ma znaczenie (np. podział działki). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Szum wartościowy z wygładzaniem. Baza terenu, wilgotności, temperatury. */
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = rnd01(x0, y0, seed, 0);
  const b = rnd01(x0 + 1, y0, seed, 0);
  const c = rnd01(x0, y0 + 1, seed, 0);
  const d = rnd01(x0 + 1, y0 + 1, seed, 0);
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Suma oktaw. Teren bazowy: fbm(x/64, y/64, seed, 5). */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}
