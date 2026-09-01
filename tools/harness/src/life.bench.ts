import { bench, describe } from 'vitest';
import { wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore } from '@rpg/world';
import { Bestiary } from '../../../apps/game/src/entities.js';

/**
 * Cykl życia bytów chodzi **co klatkę**, więc jego koszt jest kosztem stałym gry,
 * a nie kosztem zdarzenia. Mierzymy dwa przypadki, bo różnią się o rząd wielkości:
 * gracz stojący (nic się nie zmienia, sam przemiat pierścienia) i gracz biegnący
 * (klastry wchodzą i wychodzą, więc dochodzi czytanie gruntu i zwalnianie).
 */
const SEED = 4242;
const world = new ChunkStore(SEED, wildPack, 3);
world.loadRing({ x: 128.5, y: -467.5 });

function ustaw(): { b: Bestiary; x: number; y: number; z: number } {
  const b = new Bestiary(SEED, world);
  const x = 128.5;
  const y = -467.5;
  const z = world.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
  for (let i = 0; i < 3; i++) b.spawnAround(x, y, z);
  return { b, x, y, z };
}

const stoi = ustaw();
const bieg = ustaw();
// Trasę biegu wczytujemy z góry: strumieniowanie chunków to osobny budżet
// (§Budżety, 8 ms na chunk) i nie ma go tu mieszać z kosztem cyklu życia.
const ZASIEG = 80;
for (let d = -ZASIEG; d <= ZASIEG; d += 8) {
  world.loadRing({ x: bieg.x + d, y: bieg.y });
}
let bx = bieg.x;
let kierunek = 1;
const krok = 4.4 / 60 / CELL_METERS; // klatka biegu

describe('cykl życia bytów', () => {
  bench('spawnAround: gracz stoi', () => {
    stoi.b.spawnAround(stoi.x, stoi.y, stoi.z);
  });

  bench('spawnAround: gracz biegnie', () => {
    bx += krok * kierunek;
    if (bx > bieg.x + ZASIEG || bx < bieg.x - ZASIEG) kierunek = -kierunek;
    bieg.b.spawnAround(bx, bieg.y, bieg.z);
  });
});
