import { describe, it, expect } from 'vitest';
import { wildPack } from '@rpg/content';
import { ChunkStore, dungeonAt } from '@rpg/world';
import { WILD_SEED } from './scene.js';

/**
 * Punkt 7 definicji ukończenia M2: „da się wejść do jaskini, zgubić się w niej
 * i wyjść". Przechodzimy tę trasę **tymi samymi regułami kolizji, co gra** —
 * `apps/game/src/main.ts` woła dokładnie `surfaceHeight` z limitem `STEP_UP`
 * i `blocks` na wysokość sylwetki. Test jest ostrzejszy od zabawy myszką, bo
 * sprawdza każdą komórkę trasy, a nie tę, w którą akurat się wcelowało.
 */
const STEP_UP = 0.6;
const PLAYER_HEIGHT = 1.85;

interface Walker {
  feet: number;
}

/**
 * `headroom` wyłączamy na powierzchni: tam sylwetkę blokują drzewa i głazy,
 * a wokół nich w grze się po prostu obchodzi. Pod ziemią obejść nie ma —
 * korytarz albo mieści gracza, albo loch jest zepsuty.
 */
function stepTo(
  store: ChunkStore,
  w: Walker,
  cx: number,
  cy: number,
  headroom: boolean,
): string | null {
  const surf = store.surfaceHeight(cx, cy, w.feet + STEP_UP);
  if (!Number.isFinite(surf)) return `brak gruntu w (${cx},${cy})`;
  if (headroom && store.blocks(cx, cy, surf + 0.05, surf + PLAYER_HEIGHT)) {
    return `strop nie mieści sylwetki w (${cx},${cy}) na ${surf.toFixed(1)} m`;
  }
  w.feet = surf;
  return null;
}

/** Ile pierwszych komórek trasy leży jeszcze na powierzchni. */
const APPROACH = 13;

/** Trasa: od wejścia wzdłuż łańcucha korytarzy do ostatniej komory. */
function route(seed: number, nx: number, ny: number): Array<[number, number]> {
  const g = dungeonAt(seed, nx, ny);
  const path: Array<[number, number]> = [];
  // podejście z zewnątrz: dziesięć komórek wzdłuż osi wcięcia
  for (let s = 12; s >= 0; s--) path.push([g.mouthX + g.mouthDirX * s, g.mouthY + g.mouthDirY * s]);
  for (const c of g.corridors) {
    const sx = Math.sign(c.x1 - c.x0);
    const sy = Math.sign(c.y1 - c.y0);
    const len = Math.abs(c.x1 - c.x0) + Math.abs(c.y1 - c.y0);
    for (let k = 1; k <= len; k++) path.push([c.x0 + sx * k, c.y0 + sy * k]);
  }
  return path;
}

describe('wejście do jaskini', () => {
  it('trasa w głąb i z powrotem mieści się w kolizji gracza', () => {
    const store = new ChunkStore(WILD_SEED, wildPack, 3);
    const path = route(WILD_SEED, -1, -1);
    const first = path[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    store.loadRing({ x: first[0], y: first[1] });
    const w: Walker = { feet: store.surfaceHeight(first[0], first[1], 1e6) };
    expect(Number.isFinite(w.feet)).toBe(true);

    const problems: string[] = [];
    const down = 0;
    for (let i = 1; i < path.length; i++) {
      const p = path[i];
      if (p === undefined) continue;
      store.update({ x: p[0], y: p[1] });
      const err = stepTo(store, w, p[0], p[1], i >= APPROACH);
      if (err !== null) problems.push(`w dół: ${err}`);
    }
    const deepest = w.feet;
    for (let i = path.length - 2; i >= 0; i--) {
      const p = path[i];
      if (p === undefined) continue;
      store.update({ x: p[0], y: p[1] });
      const err = stepTo(store, w, p[0], p[1], i >= APPROACH);
      if (err !== null) problems.push(`w górę: ${err}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(down).toBe(0);
    // wróciliśmy na powierzchnię: głębokość zejścia była realna, a wyjście pełne
    expect(w.feet - deepest).toBeGreaterThan(15);
  });
});
