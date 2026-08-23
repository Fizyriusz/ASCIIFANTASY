import { bench, describe } from 'vitest';
import { wildPack } from '@rpg/content';
import { ChunkStore, clearRiverCache, generateChunk, riverSegments } from '@rpg/world';

/**
 * Budżet z CLAUDE.md: generacja chunka < 8 ms. Mierzymy stan ustalony —
 * cache polilinii rzek jest wtedy ciepły, bo pierścień przesuwa się o jeden
 * chunk naraz i sąsiedzi dzielą te same węzły źródłowe.
 *
 * UWAGA DO LICZB: vitest zawyża ten pomiar około czterokrotnie i nie jest to
 * szum. Generacja świata przechodzi przez granice modułów (`world/rng` →
 * `core/hash`), a vite-node wstawia tam indirekcję, której V8 nie inline'uje.
 * Zmierzone na tej samej maszynie: identyczna funkcja szumu kosztuje 31 ns jako
 * kopia lokalna i 188 ns przez import, `generateChunk` wychodzi 13,7 ms tutaj
 * i **3,6 ms w przeglądarce** przez ten sam barrel. Wiążąca jest liczba
 * z przeglądarki, bo tam działa gra; ten bench traktuj jako wykrywacz regresji
 * względem samego siebie, nie jako pomiar bezwzględny.
 */
describe('generateChunk', () => {
  // rozgrzanie: te same węzły, które będą potrzebne w pomiarze
  for (let cy = -2; cy <= 40; cy++) riverSegments(4242, 0, cy, 64);
  let i = 0;

  bench('chunk pustkowia (cache ciepły)', () => {
    generateChunk(4242, 0, i++ % 32, wildPack);
  });

  let j = 0;
  bench('chunk pustkowia (cache zimny)', () => {
    clearRiverCache();
    generateChunk(4242, 5, j++ % 8, wildPack);
  });
});

describe('ChunkStore', () => {
  const store = new ChunkStore(4242, wildPack);
  store.loadRing({ x: 0, y: 0 });
  const cam = { x: 0, y: 0 };

  bench('update podczas marszu', () => {
    cam.x += 2;
    store.update(cam);
  });
});
