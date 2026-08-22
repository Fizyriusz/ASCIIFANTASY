import { describe, it, expect } from 'vitest';
import { renderWorld, blit, MAX_HITS, Screen } from '@rpg/core';
import type { Camera, RenderContext } from '@rpg/core';
import type { SpanGrid } from '@rpg/world';
import { FakeCtx } from './fakeCtx.js';
import { assertSnapshot } from './snapshot.js';
import {
  REFERENCE,
  bridgeScene,
  emptyScene,
  interiorScene,
  referenceCamera,
  referenceCity,
  referenceContext,
  referenceScreen,
} from './scene.js';

function renderText(grid: SpanGrid, cam: Camera): string {
  const screen = referenceScreen();
  renderWorld(grid, cam, screen, referenceContext());
  return screen.toText();
}

describe('renderWorld — snapshoty', () => {
  it('ref-street: scena referencyjna, kamera domyślna', () => {
    assertSnapshot('ref-street', renderText(referenceCity(), referenceCamera()));
  });

  it('ref-turned: yaw + 0.7 — łapie błędy projekcji poza osią', () => {
    const cam = referenceCamera();
    cam.yaw += 0.7;
    assertSnapshot('ref-turned', renderText(referenceCity(), cam));
  });

  it('ref-pitch-up: pitch 0.4 — łapie błędy horyzontu', () => {
    const cam = referenceCamera();
    cam.pitch = 0.4;
    assertSnapshot('ref-pitch-up', renderText(referenceCity(), cam));
  });

  it('bridge: komórka z dwoma spanami — most nad ulicą', () => {
    const s = bridgeScene();
    assertSnapshot('bridge', renderText(s.grid, s.camera));
  });

  it('interior: span sufitu, kamera pod nim', () => {
    const s = interiorScene();
    assertSnapshot('interior', renderText(s.grid, s.camera));
  });

  it('empty: pusta siatka daje czysty ekran', () => {
    const s = emptyScene();
    const text = renderText(s.grid, s.camera);
    assertSnapshot('empty', text);
    expect(text.trim()).toBe('');
  });
});

describe('renderWorld — własności', () => {
  it('jest deterministyczny: dwa uruchomienia dają ten sam obraz', () => {
    const cam = referenceCamera();
    expect(renderText(referenceCity(), cam)).toBe(renderText(referenceCity(), cam));
  });

  it('most zasłania ulicę za sobą, ale nie całą kolumnę', () => {
    // pod przęsłem musi zostać widoczna jezdnia, nad nim — czyste niebo.
    // Gdyby span sufitowy był traktowany jak zwykła bryła, kolumna zamknęłaby
    // się w całości i ten test by to złapał.
    const s = bridgeScene();
    const screen = referenceScreen();
    renderWorld(s.grid, s.camera, screen, referenceContext());
    const mid = Math.floor(screen.cols / 2);
    let sky = 0;
    let deck = 0;
    let road = 0;
    for (let row = 0; row < screen.rows; row++) {
      const ch = screen.chars[row * screen.cols + mid] ?? 0;
      if (ch === 0) sky++;
      else if (row < screen.rows / 2) deck++;
      else road++;
    }
    expect(sky).toBeGreaterThan(0);
    expect(deck).toBeGreaterThan(0);
    expect(road).toBeGreaterThan(0);
  });

  it('wnętrze domyka kolumnę: nad kamerą jest strop, nie niebo', () => {
    const s = interiorScene();
    const screen = referenceScreen();
    renderWorld(s.grid, s.camera, screen, referenceContext());
    const mid = Math.floor(screen.cols / 2);
    let empty = 0;
    for (let row = 0; row < screen.rows; row++) {
      if ((screen.chars[row * screen.cols + mid] ?? 0) === 0) empty++;
    }
    expect(empty).toBe(0);
  });

  it('horyzont siedzi na środku ekranu przy pitch = 0', () => {
    const cam = referenceCamera();
    cam.pitch = 0;
    const screen = referenceScreen();
    const ctx: RenderContext = referenceContext();
    renderWorld(referenceCity(), cam, screen, ctx);
    expect(ctx.horizon).toBeCloseTo(REFERENCE.rows / 2, 10);
  });

  it('mieści się w budżecie wywołań fillText', () => {
    // Budżet z CLAUDE.md: ≤ 2500 wywołań na klatkę. Renderer dobiera glify z hasha,
    // więc łatwo tu wpaść: rozdrobniony szum = krótkie serie = martwy blit.
    const screen = referenceScreen();
    renderWorld(referenceCity(), referenceCamera(), screen, referenceContext());
    const ctx = new FakeCtx(screen.cols, screen.rows, 6, 10);
    blit(screen, ctx, 6, 10, 10, 'monospace', screen.cols * 6, screen.rows * 10);
    expect(ctx.fillTextCalls).toBeLessThanOrEqual(2500);
    expect(ctx.toText()).toBe(screen.toText());
  });

  it('nie alokuje: po 1000 klatkach bufory trafień są tymi samymi obiektami', () => {
    // Dowód z DoD punkt 4. Mniejszy ekran, bo mierzymy alokacje, nie wydajność.
    const grid = referenceCity();
    const cam = referenceCamera();
    const screen = new Screen(60, 24);
    const ctx = referenceContext();
    const hits = ctx.hits;
    const dist = hits.dist;
    const side = hits.side;
    const cellIndex = hits.cellIndex;

    for (let frame = 0; frame < 1000; frame++) {
      cam.yaw += 0.001;
      renderWorld(grid, cam, screen, ctx);
    }

    expect(ctx.hits).toBe(hits);
    expect(hits.dist).toBe(dist);
    expect(hits.side).toBe(side);
    expect(hits.cellIndex).toBe(cellIndex);
    expect(hits.dist.length).toBe(MAX_HITS);
    expect(hits.count).toBeLessThanOrEqual(MAX_HITS);
  });
});
