import { Screen, blit, computeMetrics, pack15, DEFAULT_TARGET_COLS } from '@rpg/core';
import { fbm } from '@rpg/world';

/**
 * Punkt wejścia. Na razie: pętla, metryki, bufor i blit — czyli wszystko poza
 * rendererem świata. M0 podmienia `drawPlaceholder` na marsz kolumnowy.
 */

const FONT_STACK = '"DejaVu Sans Mono","Liberation Mono",Menlo,Consolas,"Courier New",monospace';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Brak kontekstu 2D');

const screen = new Screen(80, 40);
let metrics = computeMetrics(1, 1, DEFAULT_TARGET_COLS, FONT_STACK, measure);

function measure(fontPx: number, fontStack: string): number {
  if (!ctx) return fontPx * 0.6;
  ctx.font = `${fontPx}px ${fontStack}`;
  return ctx.measureText('M').width;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  canvas.width = w;
  canvas.height = h;
  metrics = computeMetrics(w, h, DEFAULT_TARGET_COLS, FONT_STACK, measure);
  screen.resize(metrics.cols, metrics.rows);
}

/** Tymczasowa scena — dowód, że łańcuch bufor → blit → canvas działa. */
function drawPlaceholder(t: number): void {
  screen.clear();
  const horizon = Math.floor(screen.rows * 0.55);
  for (let col = 0; col < screen.cols; col++) {
    const hgt = fbm(col * 0.05 + t * 0.00002, 0.5, 1337, 4);
    const top = horizon - Math.floor(hgt * horizon * 0.8);
    for (let row = top; row < screen.rows; row++) {
      const depth = (row - top) / Math.max(1, screen.rows - top);
      const lum = 0.25 + 0.75 * (1 - depth);
      const ch = row === top ? 0x5e : depth < 0.25 ? 0x23 : depth < 0.6 ? 0x2b : 0x2e;
      screen.putUnsafe(col, row, ch, pack15(60 * lum, 200 * lum, 150 * lum));
    }
  }
  screen.text(2, 1, 'ASCII RPG — M0 czeka na marsz kolumnowy', pack15(230, 240, 255));
  screen.text(2, 2, `${screen.cols}x${screen.rows} znakow`, pack15(90, 140, 160));
}

function frame(t: number): void {
  drawPlaceholder(t);
  blit(screen, ctx!, metrics.cellW, metrics.cellH, metrics.fontPx, FONT_STACK,
       metrics.widthPx, metrics.heightPx);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
