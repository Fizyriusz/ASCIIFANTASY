import type { ScreenMetrics } from './screen.js';

/** Ile znaków w poziomie chcemy widzieć. Klawisze [ ] to zmieniają. */
export const DEFAULT_TARGET_COLS = 150;

/**
 * Twardy limit komórek na klatkę. Telefon w orientacji pionowej potrafi
 * wyprodukować 26 000 komórek przy tej samej szerokości czcionki co desktop,
 * i wtedy jest 8 fps. Rozmiar czcionki rośnie, aż zmieścimy się w budżecie.
 */
export const CELL_BUDGET = 15000;

export interface MeasureText {
  (fontPx: number, fontStack: string): number;
}

/**
 * Liczy metryki siatki znaków. `measure` musi zwracać realną szerokość glifu
 * monospace dla danego rozmiaru — zgadywanie 0.6 * fontPx rozjeżdża kolumny
 * na niektórych krojach.
 */
export function computeMetrics(
  widthPx: number,
  heightPx: number,
  targetCols: number,
  fontStack: string,
  measure: MeasureText,
): ScreenMetrics {
  let fontPx = Math.max(6, Math.round(widthPx / targetCols / 0.601));
  let cellW = 0;
  let cellH = 0;
  let cols = 0;
  let rows = 0;

  for (let guard = 0; guard < 48; guard++) {
    cellW = measure(fontPx, fontStack) || fontPx * 0.6;
    cellH = Math.max(4, Math.round(fontPx * 1.04));
    cols = Math.max(20, Math.floor(widthPx / cellW));
    rows = Math.max(12, Math.floor(heightPx / cellH));
    if (cols * rows <= CELL_BUDGET || fontPx > 42) break;
    fontPx++;
  }

  return { widthPx, heightPx, cols, rows, cellW, cellH, fontPx };
}
