import { bench, describe } from 'vitest';
import { compileSprite, drawSprites, renderWorld } from '@rpg/core';
import type { SpriteInstance } from '@rpg/core';
import { wildCreatures } from '@rpg/content';
import { referenceScreen, wildContext, wildScene } from './scene.js';

const def = wildCreatures[0];
if (def === undefined) throw new Error('brak goblina w paczce');
const goblin = compileSprite(def.art, { r: def.r, g: def.g, b: def.b }, def.heightM, def.widthM);

/**
 * Scena odniesienia dla M3: sześćdziesiąt bytów w kadrze, rozrzuconych po całym
 * zasięgu widzenia. Liczba z DoD M3 — tyle potworów ma udźwignąć jedna klatka
 * razem z terenem, więc mierzymy render i sprite'y osobno i razem.
 */
const s = wildScene('hills');
const ctx = wildContext();
const screen = referenceScreen();
const tlum: SpriteInstance[] = [];
for (let i = 0; i < 60; i++) {
  // wachlarz: kąt w polu widzenia, odległość rosnąca — bliskie zasłaniają dalekie
  const kat = s.camera.yaw + ((i % 12) - 5.5) * 0.06;
  const d = 3 + Math.floor(i / 12) * 6 + (i % 3);
  const x = s.camera.x + Math.cos(kat) * d;
  const y = s.camera.y + Math.sin(kat) * d;
  tlum.push({
    x,
    y,
    baseZ: s.store.spanTop(Math.floor(x), Math.floor(y), 0),
    yaw: kat + Math.PI,
    frame: i & 1,
    lum: 0.8,
    frames: goblin,
  });
}

describe('sprite', () => {
  bench('render 150x48 bez bytów', () => {
    renderWorld(s.store, s.camera, screen, ctx);
  });

  bench('sam drawSprites, 60 bytów', () => {
    drawSprites(screen, s.camera, ctx, tlum, 60);
  });

  bench('render + 60 bytów', () => {
    renderWorld(s.store, s.camera, screen, ctx);
    drawSprites(screen, s.camera, ctx, tlum, 60);
  });
});
