import { bench, describe } from 'vitest';
import { renderWorld } from '@rpg/core';
import {
  bridgeScene,
  interiorScene,
  referenceCamera,
  referenceCity,
  referenceContext,
  referenceScreen,
} from './scene.js';

/**
 * Budżet: renderWorld sceny referencyjnej ma zmieścić się poniżej 8 ms (p95),
 * a razem z blitem poniżej 16 ms na klatkę.
 *
 * Jeśli ten bench zwalnia, sprawdź w tej kolejności: czy nie przybyło spanów na
 * komórkę, czy front kolumny nadal wcześnie kończy marsz (`hiRow + 1 >= loRow`)
 * i czy w pętli wierszy nie pojawiło się coś, co alokuje.
 */
describe('renderWorld', () => {
  const city = referenceCity();
  const cityCam = referenceCamera();
  const cityScreen = referenceScreen();
  const cityCtx = referenceContext();

  bench('scena referencyjna 150x48', () => {
    renderWorld(city, cityCam, cityScreen, cityCtx);
  });

  const b = bridgeScene();
  const bridgeScreen = referenceScreen();
  const bridgeCtx = referenceContext();

  bench('most nad ulicą 150x48', () => {
    renderWorld(b.grid, b.camera, bridgeScreen, bridgeCtx);
  });

  const it2 = interiorScene();
  const interiorScreen = referenceScreen();
  const interiorCtx = referenceContext();

  bench('wnętrze 150x48', () => {
    renderWorld(it2.grid, it2.camera, interiorScreen, interiorCtx);
  });
});
