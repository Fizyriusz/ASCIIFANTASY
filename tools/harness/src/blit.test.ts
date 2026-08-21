import { describe, it, expect } from 'vitest';
import { Screen, blit, pack15 } from '@rpg/core';
import { FakeCtx } from './fakeCtx.js';
import { assertSnapshot } from './snapshot.js';

const CELL_W = 6;
const CELL_H = 10;

function scene(): Screen {
  const s = new Screen(24, 6);
  const cyan = pack15(40, 230, 255);
  const amber = pack15(255, 150, 40);
  s.text(0, 0, '####........####', cyan);
  s.text(2, 1, 'ZZZZ', amber);
  s.text(8, 1, 'ZZZZ', amber);
  s.text(0, 3, '::::::::::::::::::::', cyan);
  s.put(23, 5, 42, amber);
  return s;
}

describe('blit', () => {
  it('skleja sąsiednie znaki o tym samym kolorze w jedno wywołanie', () => {
    const s = scene();
    const ctx = new FakeCtx(s.cols, s.rows, CELL_W, CELL_H);
    blit(s, ctx, CELL_W, CELL_H, 10, 'monospace', s.cols * CELL_W, s.rows * CELL_H);

    // wiersz 0: dwie serie (cyan, przerwa na kropki jest tym samym kolorem → jedna seria)
    // wiersz 1: dwie osobne serie rozdzielone pustką
    // wiersz 3: jedna seria; wiersz 5: jeden znak
    expect(ctx.fillTextCalls).toBe(5);
    expect(ctx.glyphs).toBe(16 + 4 + 4 + 20 + 1);
  });

  it('odtworzony obraz zgadza się z buforem znaków', () => {
    const s = scene();
    const ctx = new FakeCtx(s.cols, s.rows, CELL_W, CELL_H);
    blit(s, ctx, CELL_W, CELL_H, 10, 'monospace', s.cols * CELL_W, s.rows * CELL_H);
    expect(ctx.toText()).toBe(s.toText());
  });

  it('zgadza się ze wzorcem', () => {
    assertSnapshot('blit-smoke', scene().toText());
  });
});
