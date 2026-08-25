import { bench, describe } from 'vitest';
import { renderWorld, compileMaterials } from '@rpg/core';
import { wildPack } from '@rpg/content';
import { generateChunk } from '@rpg/world';
import { dungeonScene, hutScene, referenceScreen } from './scene.js';

/**
 * Budżety M2: `renderWorld` w lochu < 8 ms, generacja chunka z lochem
 * (czyli razem z flood fillem światła) < 8 ms, a koszt kolumny z maską
 * pokrycia — zmierzony osobno, bo od niego zależy, ile otworów wolno
 * postawić w jednym kadrze.
 *
 * Ta sama uwaga o zawyżaniu co w `chunk.bench.ts`: vitest przechodzi przez
 * granice modułów bez inline'owania i mnoży wyniki mniej więcej czterokrotnie.
 * Liczby porównujemy między sobą, nie z zegarem przeglądarki.
 */
describe('renderWorld pod ziemią', () => {
  const corridor = dungeonScene('corridor');
  const corridorScreen = referenceScreen();

  bench('korytarz lochu 150x48', () => {
    renderWorld(corridor.store, corridor.camera, corridorScreen, corridor.ctx);
  });

  const room = dungeonScene('room', { sources: true });
  const roomScreen = referenceScreen();

  bench('komora z dwoma źródłami 150x48', () => {
    renderWorld(room.store, room.camera, roomScreen, room.ctx);
  });
});

/**
 * Koszt maski pokrycia. Obie sceny mają tę samą geometrię i tę samą kamerę —
 * różnią się wyłącznie tym, czy materiał otworu jest przezroczysty. Gdy nie
 * jest, kolumna wraca na szybką ścieżkę dwóch frontów i różnica czasów to
 * czysty koszt maski.
 */
describe('maska pokrycia', () => {
  const door = hutScene('door');
  const maskScreen = referenceScreen();

  bench('chata z otworami (maska)', () => {
    renderWorld(door.store, door.camera, maskScreen, door.ctx);
  });

  const opaque = hutScene('door');
  opaque.ctx.materials = compileMaterials(
    wildPack.materials.map((m) => (m.transparent === true ? { ...m, transparent: false } : m)),
  );
  const fastScreen = referenceScreen();

  bench('ta sama chata bez otworów (dwa fronty)', () => {
    renderWorld(opaque.store, opaque.camera, fastScreen, opaque.ctx);
  });
});

describe('generateChunk z lochem', () => {
  // chunk z korytarzem: geometria lochu plus dwa przebiegi pola światła
  let i = 0;
  bench('chunk z lochem (światło + spany)', () => {
    generateChunk(4242, -4, -14 + (i++ % 2), wildPack);
  });

  let j = 0;
  bench('chunk bez lochu (odniesienie)', () => {
    generateChunk(4242, 20, 20 + (j++ % 2), wildPack);
  });
});
