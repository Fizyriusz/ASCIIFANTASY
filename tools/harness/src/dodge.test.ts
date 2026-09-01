import { describe, it, expect } from 'vitest';
import { COMBAT, PLAYER, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, dungeonsNear } from '@rpg/world';
import type { DungeonGraph } from '@rpg/world';
import { Stance, beginDodge, makeActor, tickActor } from '@rpg/rules';
import { dodgeSpeed, tryStep } from '../../../apps/game/src/move.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;
const DT = 16;
const CIALO = { heightM: 1.85, stepUpM: 0.6, wadeM: 1 };

/**
 * Unik przeprowadzony **tą samą drogą, którą chodzi gra**: `dodgeSpeed` na profil
 * prędkości i `tryStep` na kolizję, osobno w X i Y. Zwraca przebytą odległość
 * w metrach.
 */
function unik(
  world: ChunkStore,
  start: { x: number; y: number; z: number },
  dir: { dx: number; dy: number },
): { x: number; y: number; dystansM: number } {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  expect(beginDodge(a)).toBe(true);
  let x = start.x;
  let y = start.y;
  let feet = start.z;

  while (a.stance === Stance.Dodging && a.dodgeMs > 0) {
    const v = dodgeSpeed(a.dodgeMs, COMBAT.dodgeWindowMs, COMBAT.dodgeDistanceM) / CELL_METERS;
    const dt = DT / 1000;
    const kx = tryStep(world, feet, x + dir.dx * v * dt, y, CIALO);
    if (kx !== null) {
      x = kx.x;
      feet = kx.surfZ;
    }
    const ky = tryStep(world, feet, x, y + dir.dy * v * dt, CIALO);
    if (ky !== null) {
      y = ky.y;
      feet = ky.surfZ;
    }
    tickActor(a, DT);
  }
  return { x, y, dystansM: Math.hypot(x - start.x, y - start.y) * CELL_METERS };
}

function najblizszyLoch(): DungeonGraph {
  const graphs = dungeonsNear(SEED, START_X - 1024, START_Y - 1024, START_X + 1024, START_Y + 1024);
  let best: DungeonGraph | null = null;
  let bestD = Infinity;
  for (const g of graphs) {
    const d = (g.mouthX - START_X) ** 2 + (g.mouthY - START_Y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (best === null) throw new Error('brak lochu w zasięgu startu');
  return best;
}

describe('unik jest ruchem, nie znaczkiem', () => {
  it('przesuwa gracza o zadany dystans i w zadanym kierunku', () => {
    // Sygnałem uniku ma być to, że świat jedzie w drugą stronę — więc dystans
    // jest daną z contentu, a nie wypadkową kroku czasowego.
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: START_X, y: START_Y });
    const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);

    for (const dir of [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ]) {
      const r = unik(world, { x: START_X, y: START_Y, z }, dir);
      expect(r.dystansM).toBeGreaterThan(COMBAT.dodgeDistanceM * 0.8);
      expect(r.dystansM).toBeLessThan(COMBAT.dodgeDistanceM * 1.2);
      // ...i dokładnie w tę stronę, w którą prosiliśmy
      if (dir.dx !== 0) expect(Math.sign(r.x - START_X)).toBe(Math.sign(dir.dx));
      if (dir.dy !== 0) expect(Math.sign(r.y - START_Y)).toBe(Math.sign(dir.dy));
    }
  });

  it('unik w ścianę nie przesuwa i nie przenika', () => {
    // Przesunięcie „bo to tylko efekt" jest najprostszym sposobem na wyjście gracza
    // za geometrię. Ta sama kolizja co przy kroku znaczy: w ścianę się nie da.
    const g = najblizszyLoch();
    let komora = g.rooms[0]!;
    for (const r of g.rooms) if (r.level > komora.level) komora = r;
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: komora.x + komora.w / 2, y: komora.y + komora.h / 2 });

    // Ściany szukamy pomiarem, a nie z obrysu komory: krawędź prostokąta nie musi
    // być litą skałą — po drugiej stronie bywa korytarz.
    const y = komora.y + Math.floor(komora.h / 2);
    const z = komora.floorZ;
    let sciana = komora.x - 1;
    for (let x = komora.x - 1; x < komora.x + komora.w; x++) {
      if (world.blocks(x, y, z + 0.1, z + CIALO.heightM)) sciana = x;
      else break;
    }
    // stajemy tuż obok niej, twarzą do skały
    const x = sciana + 1.05;
    expect(world.blocks(sciana, y, z + 0.1, z + CIALO.heightM)).toBe(true);

    const r = unik(world, { x, y: y + 0.5, z }, { dx: -1, dy: 0 });

    expect(r.dystansM).toBeLessThan(0.3);
    // i nadal stoimy w komorze, a nie w litej skale
    expect(world.blocks(Math.floor(r.x), Math.floor(r.y), z + 0.1, z + CIALO.heightM)).toBe(false);
  });

  it('profil prędkości daje zadany dystans, niezależnie od kroku czasowego', () => {
    // Całka po oknie ma dać dokładnie `dodgeDistanceM` — inaczej dystans zależałby
    // od liczby klatek, czyli od maszyny gracza.
    for (const krok of [8, 16, 33]) {
      let s = 0;
      for (let pozostalo = COMBAT.dodgeWindowMs; pozostalo > 0; pozostalo -= krok) {
        s += (dodgeSpeed(pozostalo, COMBAT.dodgeWindowMs, COMBAT.dodgeDistanceM) * krok) / 1000;
      }
      expect(s).toBeGreaterThan(COMBAT.dodgeDistanceM * 0.85);
      expect(s).toBeLessThan(COMBAT.dodgeDistanceM * 1.15);
    }
  });

  it('unik zaczyna się szarpnięciem, a kończy wyhamowaniem', () => {
    const start = dodgeSpeed(COMBAT.dodgeWindowMs, COMBAT.dodgeWindowMs, COMBAT.dodgeDistanceM);
    const polowa = dodgeSpeed(COMBAT.dodgeWindowMs / 2, COMBAT.dodgeWindowMs, COMBAT.dodgeDistanceM);
    const koniec = dodgeSpeed(0, COMBAT.dodgeWindowMs, COMBAT.dodgeDistanceM);
    expect(start).toBeGreaterThan(polowa);
    expect(polowa).toBeGreaterThan(koniec);
    // szarpnięcie ma być wyraźnie szybsze od biegu, inaczej nie czyta się jako unik
    expect(start).toBeGreaterThan(5);
  });
});
