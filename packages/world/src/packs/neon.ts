/**
 * Generator miasta z paczki `neon` — cyberpunk z M0, odłożony na bok.
 *
 * Dlaczego generator siedzi w `world`, a nie w `packages/content`, mimo że
 * zlecenie M1 mówiło inaczej: `content` leży **najniżej** w łańcuchu zależności
 * z CLAUDE.md, więc nie może importować `Span` ani `SpanGrid` z `world`.
 * Generator zwracający `SpanGrid` musiałby ten kierunek odwrócić. W paczce
 * zostają dane (materiały), tutaj jest kod, który z nich buduje.
 *
 * Ten świat jest **zamrożony**: złote pliki `ref-street`, `ref-turned`
 * i `ref-pitch-up` zależą od każdej liczby poniżej co do bajta.
 */

import { NeonMat } from '@rpg/content';
import type { MaterialId, Span, SpanFlagMask } from '../types.js';
import { SpanFlags } from '../types.js';
import { h32, mulberry32, vnoise } from '../rng.js';
import { SpanGrid } from '../grid.js';

const CITY_SIZE = 64;
/** ulice co 8 komórek, aleje co 32 — układ z prototypu */
const BLOCK = 8;
const AVENUE = 32;

function isRoad(x: number, y: number): boolean {
  return (
    (x & (BLOCK - 1)) === 0 ||
    (y & (BLOCK - 1)) === 0 ||
    (x > 0 && (x - 1) % AVENUE === 0) ||
    (y > 0 && (y - 1) % AVENUE === 0)
  );
}

function span(
  bottom: number,
  top: number,
  mat: MaterialId,
  capMat: MaterialId,
  flags: SpanFlagMask,
): Span {
  return { bottom, top, mat, capMat, flags };
}

/**
 * Odtwarza układ z prototypu: siatka ulic, chodniki przy jezdni, kwartały
 * budynków 1–3 komórek, wysokości z szumu. Świadomie prymitywne — jedyne, co
 * musi być prawdą, to determinizm i sensowne proporcje do oglądania renderera.
 */
export function buildNeonCity(seed: number): SpanGrid {
  const grid = new SpanGrid(CITY_SIZE, CITY_SIZE);

  // 1. teren: jezdnia, chodnik, trawnik działki
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      const road = isRoad(x, y);
      const nextToRoad =
        !road &&
        (isRoad(x + 1, y) || isRoad(x - 1, y) || isRoad(x, y + 1) || isRoad(x, y - 1));
      const capMat = road ? NeonMat.Asphalt : nextToRoad ? NeonMat.Pavement : NeonMat.Grass;
      const topZ = road ? 0 : nextToRoad ? 0.2 : 0.15;
      grid.setColumn(x, y, [span(-4, topZ, NeonMat.Stone, capMat, SpanFlags.Solid)]);
    }
  }

  // 2. budynki na działkach — kwartały 1–3 komórek, wysokość z gęstości dzielnicy
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      if (isRoad(x, y)) continue;
      if (isRoad(x + 1, y) || isRoad(x - 1, y) || isRoad(x, y + 1) || isRoad(x, y - 1)) continue;
      if (grid.spanCount(x, y) > 1) continue; // już zabudowane przez sąsiada

      const lot = mulberry32(h32(x, y, seed, 5));
      if (lot() < 0.12) continue; // pusta działka / skwer

      const density = vnoise(x / 26, y / 26, seed + 3);
      const w = 1 + ((lot() * 3) | 0);
      const d = 1 + ((lot() * 3) | 0);
      const height = 4 + Math.pow(density, 2.2) * 34 * (0.4 + 0.6 * lot());
      const wallMat = lot() < 0.35 ? NeonMat.Glass : lot() < 0.7 ? NeonMat.Plaster : NeonMat.Stone;

      for (let dy = 0; dy < d; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const bx = x + dx;
          const by = y + dy;
          if (bx >= CITY_SIZE || by >= CITY_SIZE) continue;
          if (isRoad(bx, by)) continue;
          if (isRoad(bx + 1, by) || isRoad(bx - 1, by) || isRoad(bx, by + 1) || isRoad(bx, by - 1)) {
            continue;
          }
          if (grid.spanCount(bx, by) > 1) continue;
          grid.setColumn(bx, by, [
            span(-4, 0.15, NeonMat.Stone, NeonMat.Grass, SpanFlags.Solid),
            span(0.15, height, wallMat, NeonMat.Stone, SpanFlags.Solid),
          ]);
          grid.setLight(bx, by, 12);
        }
      }
    }
  }

  // 3. latarnie — pojedyncze świecące słupki na chodniku, co szesnastą komórkę
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      if (isRoad(x, y) || grid.spanCount(x, y) > 1) continue;
      if ((x & 15) !== 4 || (y & 15) !== 4) continue;
      grid.setColumn(x, y, [
        span(-4, 0.2, NeonMat.Stone, NeonMat.Pavement, SpanFlags.Solid),
        span(0.2, 4.2, NeonMat.Lamp, NeonMat.Lamp, SpanFlags.Solid | SpanFlags.Emissive),
      ]);
    }
  }

  // 4. kładka nad aleją — jedyny element, którego prototyp nie umiał pokazać;
  //    stoi tu po to, żeby model spanów było widać w żywej aplikacji, nie tylko
  //    w snapshocie testowym
  const bridgeY = 32;
  for (let x = 28; x <= 36; x++) {
    grid.setColumn(x, bridgeY, [
      span(-4, isRoad(x, bridgeY) ? 0 : 0.2, NeonMat.Stone, NeonMat.Asphalt, SpanFlags.Solid),
      span(5, 5.8, NeonMat.Wood, NeonMat.Wood, SpanFlags.Solid),
    ]);
  }
  return grid;
}
