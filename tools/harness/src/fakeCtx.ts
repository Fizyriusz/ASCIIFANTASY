import type { Blittable } from '@rpg/core';

/**
 * Atrapa kontekstu 2D. Pozwala renderować headless w Node i sprawdzać nie tylko
 * *co* narysowaliśmy, ale też *ile kosztowało* — liczba wywołań fillText jest
 * pozycją budżetową, więc testujemy ją tak samo jak obraz.
 */
export class FakeCtx implements Blittable {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  font = '';
  textBaseline = '';

  fillTextCalls = 0;
  glyphs = 0;
  fillRects = 0;
  /** rekonstrukcja obrazu z wywołań rysujących — łapie błędy pozycjonowania */
  grid: string[][];

  constructor(
    private cols: number,
    private rows: number,
    private cellW: number,
    private cellH: number,
  ) {
    this.grid = Array.from({ length: rows }, () => new Array<string>(cols).fill(' '));
  }

  fillRect(): void {
    this.fillRects++;
    for (const row of this.grid) row.fill(' ');
  }

  fillText(s: string, x: number, y: number): void {
    this.fillTextCalls++;
    this.glyphs += s.length;
    const col = Math.round(x / this.cellW);
    const row = Math.round(y / this.cellH);
    if (row < 0 || row >= this.rows) return;
    const line = this.grid[row];
    if (!line) return;
    for (let k = 0; k < s.length; k++) {
      const c = col + k;
      if (c >= 0 && c < this.cols) line[c] = s[k] ?? ' ';
    }
  }

  toText(): string {
    return this.grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
  }
}
