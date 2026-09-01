/**
 * Kolizja gracza w jednym miejscu.
 *
 * Powód wydzielenia jest konkretny: od M3f gracza przesuwa nie tylko chodzenie, ale
 * też unik. Dwie ścieżki ruchu znaczą dwie kolizje, a druga z nich prędzej czy później
 * przepuści gracza przez ścianę — bo „to tylko efekt". Tu jest jedna funkcja, z której
 * korzystają obie, i którą da się sprawdzić testem bez uruchamiania gry.
 */

import type { ChunkStore } from '@rpg/world';

export interface Ciało {
  /** metry: pełna wysokość sylwetki — o nią pytamy przy nadprożu */
  heightM: number;
  /** metry: próg, na który da się wejść bez skakania */
  stepUpM: number;
  /** metry: głębsza woda jest nie do przejścia */
  wadeM: number;
}

export interface Krok {
  /** komórki: pozycja po ruchu */
  x: number;
  y: number;
  /** metry: wysokość gruntu w nowym miejscu */
  surfZ: number;
}

/**
 * Próba przesunięcia z `(x, y)` na `(nx, ny)`. Zwraca nową pozycję albo `null`, gdy
 * ruch jest niemożliwy: brak gruntu, zbyt niskie nadproże, za głęboka woda albo cudze
 * ciało. Kolizja jest celowo prymitywna — próg, ściana i głębina.
 *
 * `zajete` jest osobnym parametrem, a nie odwołaniem do bestiariusza, bo ta funkcja
 * nie ma prawa wiedzieć, że istnieją potwory: dostaje pytanie „czy tu ktoś stoi".
 */
export function tryStep(
  world: ChunkStore,
  feetZ: number,
  nx: number,
  ny: number,
  cialo: Ciało,
  zajete?: (x: number, y: number) => boolean,
): Krok | null {
  if (zajete !== undefined && zajete(nx, ny)) return null;
  const cx = Math.floor(nx);
  const cy = Math.floor(ny);
  const surf = world.surfaceHeight(cx, cy, feetZ + cialo.stepUpM);
  if (!Number.isFinite(surf)) return null; // chunk jeszcze się nie policzył
  if (world.blocks(cx, cy, surf + 0.05, surf + cialo.heightM)) return null;
  const water = world.waterLevel(cx, cy);
  if (water !== null && water - surf > cialo.wadeM) return null;
  return { x: nx, y: ny, surfZ: surf };
}

/**
 * Prędkość uniku w danej chwili okna. Profil jest malejący: szarpnięcie na starcie,
 * wyhamowanie na końcu — całka po całym oknie daje dokładnie `dystansM`, więc dystans
 * jest daną, a nie wypadkową kroku czasowego.
 */
export function dodgeSpeed(pozostaloMs: number, oknoMs: number, dystansM: number): number {
  if (oknoMs <= 0) return 0;
  const t = 1 - pozostaloMs / oknoMs; // 0 na starcie, 1 na końcu
  if (t < 0 || t > 1) return 0;
  return ((2 * dystansM) / (oknoMs / 1000)) * (1 - t);
}
