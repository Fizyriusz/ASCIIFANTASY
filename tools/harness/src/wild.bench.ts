import { bench, describe } from 'vitest';
import { renderWorld } from '@rpg/core';
import { referenceScreen, wildContext, wildScene } from './scene.js';

describe('pustkowie', () => {
  const screen = referenceScreen();
  const ctx = wildContext();
  for (const view of ['hills', 'forest', 'seam'] as const) {
    const s = wildScene(view);
    bench(`wild-${view} 150x48`, () => {
      renderWorld(s.store, s.camera, screen, ctx);
    });
  }
});
