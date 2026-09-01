import { bench, describe } from 'vitest';
import { Screen } from './screen.js';
import { blit } from './blit.js';
import { pack15 } from './color.js';
/**
 * Własny generator zamiast `rnd01` z `@rpg/world`: `packages/core` nie importuje
 * niczego z warstw powyżej, także w benchu. Import „tylko do pomiaru" jest tą samą
 * zależnością — i to on zwykle zostaje.
 */
function rnd01(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Budżet: blit sceny referencyjnej (150x48) musi zmieścić się z zapasem w klatce.
 * Jeśli ten bench zwalnia, najpierw sprawdź, czy serie run-length się nie skróciły
 * — to zwykle znaczy, że ktoś przestał kwantyzować kolor.
 */
const noop = {
  fillStyle: '' as string,
  font: '',
  textBaseline: '',
  fillRect(): void {},
  fillText(): void {},
};

function referenceScreen(): Screen {
  const s = new Screen(150, 48);
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const band = Math.floor(c / 7); // symuluje fasady: serie tego samego koloru
      const lum = 0.3 + 0.7 * rnd01(band, r, 1);
      s.putUnsafe(c, r, 0x23, pack15(40 * lum, 220 * lum, 255 * lum));
    }
  }
  return s;
}

describe('blit', () => {
  const s = referenceScreen();
  bench('scena referencyjna 150x48', () => {
    blit(s, noop, 10, 16, 16, 'monospace', 1500, 768);
  });
});
