import { describe, it, expect } from 'vitest';
import { computeMetrics, CELL_BUDGET } from './metrics.js';

/** monospace: szerokość glifu ≈ 0.6 wysokości */
const measure = (fontPx: number): number => fontPx * 0.601;

describe('computeMetrics', () => {
  it('trafia mniej więcej w zadaną liczbę kolumn na desktopie', () => {
    const m = computeMetrics(1920, 1080, 150, 'monospace', measure);
    expect(m.cols).toBeGreaterThan(130);
    expect(m.cols).toBeLessThan(170);
  });

  it('nie przekracza budżetu komórek na telefonie w pionie', () => {
    // 390x844 przy dpr 2 — układ, który w prototypie dawał 26 000 komórek
    const m = computeMetrics(780, 1688, 150, 'monospace', measure);
    expect(m.cols * m.rows).toBeLessThanOrEqual(CELL_BUDGET);
  });

  it('nie przekracza budżetu na żadnym typowym ekranie', () => {
    const screens: Array<[number, number]> = [
      [780, 1688], [828, 1792], [1170, 2532], [1920, 1080],
      [2560, 1440], [3840, 2160], [1440, 3200], [640, 480],
    ];
    for (const [w, h] of screens) {
      const m = computeMetrics(w, h, 150, 'monospace', measure);
      expect(m.cols * m.rows).toBeLessThanOrEqual(CELL_BUDGET);
      expect(m.fontPx).toBeGreaterThanOrEqual(6);
    }
  });
});
