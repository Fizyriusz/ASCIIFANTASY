import type { Screen } from './screen.js';
import { EMPTY } from './screen.js';
import { cssOf } from './color.js';

/**
 * Minimalny kontrakt kontekstu 2D, jakiego potrzebuje blit.
 * Dzięki temu harness testowy podstawia atrapę i renderujemy headless w Node.
 */
export interface Blittable {
  /** unia zgodna z CanvasRenderingContext2D — my zapisujemy tu wyłącznie string */
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(s: string, x: number, y: number): void;
}

export interface BlitStats {
  fillTextCalls: number;
  glyphs: number;
}

/**
 * Run-length blit: skleja sąsiednie znaki o tym samym kolorze w jeden fillText.
 * To jest miejsce, w którym rodzi się wydajność całego projektu — bez tego
 * jest 15 fps zamiast 60. Zwraca statystyki do pilnowania budżetu.
 */
export function blit(
  screen: Screen,
  ctx: Blittable,
  cellW: number,
  cellH: number,
  fontPx: number,
  fontStack: string,
  widthPx: number,
  heightPx: number,
  stats?: BlitStats,
): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.font = `${fontPx}px ${fontStack}`;
  ctx.textBaseline = 'top';

  const { cols, rows, chars, colors } = screen;
  let calls = 0;
  let glyphs = 0;

  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const y = r * cellH;
    let c = 0;
    while (c < cols) {
      const ch = chars[base + c] ?? EMPTY;
      if (ch === EMPTY) {
        c++;
        continue;
      }
      const color = colors[base + c] ?? 0;
      let run = String.fromCharCode(ch);
      let c2 = c + 1;
      while (c2 < cols) {
        const ch2 = chars[base + c2] ?? EMPTY;
        if (ch2 === EMPTY || colors[base + c2] !== color) break;
        run += String.fromCharCode(ch2);
        c2++;
      }
      ctx.fillStyle = cssOf(color);
      ctx.fillText(run, c * cellW, y);
      calls++;
      glyphs += run.length;
      c = c2;
    }
  }

  if (stats) {
    stats.fillTextCalls = calls;
    stats.glyphs = glyphs;
  }
}
