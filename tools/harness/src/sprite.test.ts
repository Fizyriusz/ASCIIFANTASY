import { describe, it, expect } from 'vitest';
import { compileSprite, drawSprites, renderWorld } from '@rpg/core';
import type { SpriteInstance } from '@rpg/core';
import { wildCreatures, wildPack } from '@rpg/content';
import { assertSnapshot } from './snapshot.js';
import {
  DUNGEON_VIEWS,
  dungeonScene,
  hutScene,
  referenceScreen,
  wildContext,
  wildScene,
} from './scene.js';

const goblinDef = wildCreatures[0];
if (goblinDef === undefined) throw new Error('brak goblina w paczce');
const goblin = compileSprite(
  goblinDef.art,
  { r: goblinDef.r, g: goblinDef.g, b: goblinDef.b },
  goblinDef.heightM,
  goblinDef.widthM,
);

/** Byt postawiony na gruncie w podanej komórce, oświetlony jak ta komórka. */
function stand(
  store: { spanTop: (x: number, y: number, i: number) => number; light: (x: number, y: number) => number },
  x: number,
  y: number,
  yaw: number,
  frame = 0,
  lum?: number,
): SpriteInstance {
  const raw = store.light(Math.floor(x), Math.floor(y));
  const surface = (raw >> 4) || (raw & 15);
  return {
    x,
    y,
    baseZ: store.spanTop(Math.floor(x), Math.floor(y), 0),
    yaw,
    frame,
    lum: lum ?? surface * 0.0667,
    frames: goblin,
  };
}

describe('sprite w kadrze', () => {
  it('sprite-near: goblin dwa metry przed kamerą', () => {
    const s = wildScene('hills');
    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(s.store, s.camera, screen, ctx);
    const ahead = {
      x: s.camera.x + Math.cos(s.camera.yaw) * 1,
      y: s.camera.y + Math.sin(s.camera.yaw) * 1,
    };
    const g = stand(s.store, ahead.x, ahead.y, s.camera.yaw + Math.PI);
    expect(drawSprites(screen, s.camera, ctx, [g], 1)).toBe(1);
    assertSnapshot('sprite-near', screen.toText());
  });

  it('sprite-far: ten sam goblin dwanaście metrów dalej', () => {
    const s = wildScene('hills');
    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(s.store, s.camera, screen, ctx);
    const ahead = {
      // 6 komórek = 12 m; dalej na tej scenie byt wchodzi w zagłębienie terenu
      // i snapshot pokazywałby zasłanianie zamiast skali
      x: s.camera.x + Math.cos(s.camera.yaw) * 6,
      y: s.camera.y + Math.sin(s.camera.yaw) * 6,
    };
    const g = stand(s.store, ahead.x, ahead.y, s.camera.yaw + Math.PI);
    drawSprites(screen, s.camera, ctx, [g], 1);
    assertSnapshot('sprite-far', screen.toText());
  });

  it('sprite-facing-away: ten sam byt tyłem to inny zestaw znaków', () => {
    const s = wildScene('hills');
    const screen = referenceScreen();
    const ctx = wildContext();
    const przod = referenceScreen();
    const ahead = {
      x: s.camera.x + Math.cos(s.camera.yaw) * 4,
      y: s.camera.y + Math.sin(s.camera.yaw) * 4,
    };
    renderWorld(s.store, s.camera, przod, ctx);
    drawSprites(przod, s.camera, ctx, [stand(s.store, ahead.x, ahead.y, s.camera.yaw + Math.PI)], 1);
    renderWorld(s.store, s.camera, screen, ctx);
    drawSprites(screen, s.camera, ctx, [stand(s.store, ahead.x, ahead.y, s.camera.yaw)], 1);
    assertSnapshot('sprite-facing-away', screen.toText());
    expect(screen.toText()).not.toBe(przod.toText());
  });
});

describe('sprite a geometria', () => {
  it('sprite-occluded: za ścianą go nie widać', () => {
    // Goblin stoi w korytarzu za zakrętem, kamera patrzy w litą skałę.
    const s = dungeonScene('corridor');
    const screen = referenceScreen();
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, s.ctx);
    renderWorld(s.store, s.camera, screen, s.ctx);
    const dx = Math.cos(s.camera.yaw);
    const dy = Math.sin(s.camera.yaw);
    // trzy komórki w bok od osi korytarza, czyli po drugiej stronie ściany
    const g = stand(s.store, s.camera.x + dx * 6 - dy * 3, s.camera.y + dy * 6 + dx * 3, 0, 0, 1);
    drawSprites(screen, s.camera, s.ctx, [g], 1);
    assertSnapshot('sprite-occluded', screen.toText());
    // test głębi zadziałał, jeśli obraz jest identyczny jak bez sprite'a
    expect(screen.toText()).toBe(pusty.toText());
  });

  it('sprite-in-doorway: przez otwarte drzwi widać go w całości', () => {
    const s = hutScene('door');
    const screen = referenceScreen();
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, s.ctx);
    renderWorld(s.store, s.camera, screen, s.ctx);
    // wnętrze chaty, tuż za progiem
    const g = stand(s.store, s.camera.x, s.camera.y + 4, -Math.PI / 2, 0, 0.8);
    const drawn = drawSprites(screen, s.camera, s.ctx, [g], 1);
    assertSnapshot('sprite-in-doorway', screen.toText());
    expect(drawn).toBe(1);
    expect(screen.toText()).not.toBe(pusty.toText());
  });

  it('sprite-in-darkness: w ciemnym lochu jest niewidoczny', () => {
    // Ta sama zasada co dla powierzchni w M2: bez światła nie ma obrazu.
    const s = dungeonScene('torch', { torch: false });
    const screen = referenceScreen();
    const v = DUNGEON_VIEWS.torch;
    renderWorld(s.store, s.camera, screen, s.ctx);
    const g = stand(s.store, v.x + Math.cos(v.yaw) * 3, v.y + Math.sin(v.yaw) * 3, 0, 0, 0);
    drawSprites(screen, s.camera, s.ctx, [g], 1);
    assertSnapshot('sprite-in-darkness', screen.toText());
    let painted = 0;
    for (let i = 0; i < screen.chars.length; i++) if ((screen.chars[i] ?? 0) !== 0) painted++;
    expect(painted).toBe(0);
  });
});

describe('sprite — własności', () => {
  it('wysokość na ekranie jest odwrotnie proporcjonalna do odległości', () => {
    // Sprite ma kurczyć się dokładnie jak ściana obok niego, więc iloczyn
    // (wysokość w wierszach × odległość) jest stały. Mierzymy go, a nie samo
    // „maleje" — malenie przechodzi też wtedy, gdy skala jest błędna.
    // Odległości dobrane tak, żeby byt mieścił się w kadrze (bliżej jest ucinany
    // dołem ekranu) i nie chował się za wzniesieniem (dalej niż 16 m znika).
    const s = wildScene('hills');
    const ctx = wildContext();
    const iloczyny: number[] = [];
    for (const d of [4, 6, 8]) {
      const screen = referenceScreen();
      renderWorld(s.store, s.camera, screen, ctx);
      const x = s.camera.x + Math.cos(s.camera.yaw) * d;
      const y = s.camera.y + Math.sin(s.camera.yaw) * d;
      const g = stand(s.store, x, y, s.camera.yaw + Math.PI);
      expect(drawSprites(screen, s.camera, ctx, [g], 1)).toBe(1);
      // wiersze bytu poznajemy po głębokości: sprite zapisuje dokładnie swój dystans
      const distM = d * ctx.metersPerCell;
      let top = screen.rows;
      let bot = -1;
      for (let r = 0; r < screen.rows; r++) {
        for (let c = 0; c < screen.cols; c++) {
          const dep = screen.depth[r * screen.cols + c] ?? Infinity;
          if (Math.abs(dep - distM) < 0.05) {
            if (r < top) top = r;
            if (r > bot) bot = r;
          }
        }
      }
      iloczyny.push((bot - top + 1) * distM);
    }
    const sredni = iloczyny.reduce((a, b) => a + b, 0) / iloczyny.length;
    for (const it of iloczyny) {
      // 15% luzu na zaokrąglenie do wiersza — przy 9 wierszach jeden wiersz to 11%
      expect(Math.abs(it - sredni) / sredni).toBeLessThan(0.15);
    }
  });

  it('sprite zapisuje głębokość, więc bliższy zasłania dalszy', () => {
    const s = wildScene('hills');
    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(s.store, s.camera, screen, ctx);
    const dx = Math.cos(s.camera.yaw);
    const dy = Math.sin(s.camera.yaw);
    const daleki = stand(s.store, s.camera.x + dx * 6, s.camera.y + dy * 6, s.camera.yaw + Math.PI);
    const bliski = stand(s.store, s.camera.x + dx * 2, s.camera.y + dy * 2, s.camera.yaw + Math.PI);
    // kolejność nie ma znaczenia: dalszy najpierw, potem bliższy i odwrotnie
    const a = referenceScreen();
    renderWorld(s.store, s.camera, a, ctx);
    drawSprites(a, s.camera, ctx, [daleki, bliski], 2);
    const b = referenceScreen();
    renderWorld(s.store, s.camera, b, ctx);
    drawSprites(b, s.camera, ctx, [bliski, daleki], 2);
    expect(a.toText()).toBe(b.toText());
  });
});
