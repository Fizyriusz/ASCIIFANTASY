/**
 * Sceny referencyjne dla snapshotów.
 *
 * Render jest tekstem, więc regresja graficzna to diff tekstowy — ale tylko
 * wtedy, gdy scena jest w 100% deterministyczna. Wszystko tutaj wynika z seeda
 * i stałych: żadnego czasu, żadnego Math.random(), żadnego rozmiaru okna.
 */

import { Screen, createRenderContext, MATERIALS, Mat } from '@rpg/core';
import type { Camera, RenderContext } from '@rpg/core';
import { SpanGrid, buildTestCity, SpanFlags, CELL_METERS } from '@rpg/world';
import type { Span } from '@rpg/world';

export const REFERENCE = {
  seed: 1337,
  camera: { x: 33.0, y: 32.5, eyeZ: 0.9, yaw: Math.PI / 2, pitch: 0.06, fov: (74 * Math.PI) / 180 },
  cols: 150,
  rows: 48,
} as const;

/**
 * Proporcje komórki znakowej. Nie są dowolne: metrics.ts liczy cellW ≈ 0.601·fontPx
 * i cellH ≈ 1.04·fontPx, a stosunek cellW/cellH wchodzi wprost w Kv. Podanie tu
 * okrągłych 6/10 dałoby snapshoty o innych proporcjach niż realny render.
 */
export const CELL_W = 6.01;
export const CELL_H = 10.4;

export function referenceCamera(): Camera {
  return {
    x: REFERENCE.camera.x,
    y: REFERENCE.camera.y,
    eyeZ: REFERENCE.camera.eyeZ,
    yaw: REFERENCE.camera.yaw,
    pitch: REFERENCE.camera.pitch,
    fov: REFERENCE.camera.fov,
  };
}

export function referenceScreen(): Screen {
  return new Screen(REFERENCE.cols, REFERENCE.rows);
}

export function referenceContext(): RenderContext {
  return createRenderContext(MATERIALS, {
    cellW: CELL_W,
    cellH: CELL_H,
    metersPerCell: CELL_METERS,
    maxDepth: 64,
    fogDist: 90,
    ambient: 0.3,
  });
}

export function referenceCity(): SpanGrid {
  return buildTestCity(REFERENCE.seed);
}

function span(bottom: number, top: number, mat: number, capMat: number): Span {
  return { bottom, top, mat, capMat, flags: SpanFlags.Solid };
}

/**
 * Most nad ulicą: komórki z dwoma spanami — jezdnia i kładka nad nią. To jest
 * przypadek, którego model "jedna wysokość na komórkę" nie umie wyrazić, więc
 * ten snapshot jest właściwym dowodem, że M0 zrobiono na spanach.
 */
export function bridgeScene(): { grid: SpanGrid; camera: Camera } {
  const grid = new SpanGrid(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      grid.setColumn(x, y, [span(-4, 0, Mat.Stone, Mat.Asphalt)]);
    }
  }
  // przęsło w poprzek ulicy, 4.0–4.6 m nad jezdnią
  for (let x = 10; x <= 22; x++) {
    grid.setColumn(x, 16, [span(-4, 0, Mat.Stone, Mat.Asphalt), span(4, 4.6, Mat.Wood, Mat.Wood)]);
  }
  // filary po obu stronach
  for (const px of [10, 22]) {
    grid.setColumn(px, 16, [span(-4, 0, Mat.Stone, Mat.Asphalt), span(0, 4.6, Mat.Stone, Mat.Wood)]);
  }
  return {
    grid,
    camera: { x: 16.5, y: 10.5, eyeZ: 1.6, yaw: Math.PI / 2, pitch: 0, fov: (74 * Math.PI) / 180 },
  };
}

/**
 * Wnętrze: pokój ze stropem nad kamerą. Dla renderera to zwykły przypadek —
 * span sufitu domyka kolumnę od góry — i o to w spanach chodziło.
 */
export function interiorScene(): { grid: SpanGrid; camera: Camera } {
  const grid = new SpanGrid(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      grid.setColumn(x, y, [span(-4, 0, Mat.Stone, Mat.Pavement)]);
    }
  }
  const x0 = 12;
  const y0 = 12;
  const x1 = 21;
  const y1 = 21;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wall = x === x0 || x === x1 || y === y0 || y === y1;
      if (wall) {
        // strop leży także nad ścianą — bez tego między krawędzią stropu a szczytem
        // ściany zostaje pasek, który nie należy do żadnej bryły, i renderer
        // słusznie zostawia go pustym
        grid.setColumn(x, y, [
          span(-4, 0, Mat.Stone, Mat.Wood),
          span(0, 3, Mat.Stone, Mat.Stone),
          span(3, 3.4, Mat.Wood, Mat.Stone),
        ]);
      } else {
        grid.setColumn(x, y, [
          span(-4, 0, Mat.Stone, Mat.Wood),
          span(3, 3.4, Mat.Wood, Mat.Stone),
        ]);
      }
      grid.setLight(x, y, 8);
    }
  }
  return {
    grid,
    camera: { x: 16.5, y: 14.5, eyeZ: 1.6, yaw: Math.PI / 2, pitch: 0, fov: (74 * Math.PI) / 180 },
  };
}

/** Pusta siatka — kolumna bez trafień musi zostawić czyste tło, nie śmieci. */
export function emptyScene(): { grid: SpanGrid; camera: Camera } {
  return {
    grid: new SpanGrid(32, 32),
    camera: { x: 16.5, y: 16.5, eyeZ: 1.6, yaw: Math.PI / 2, pitch: 0, fov: (74 * Math.PI) / 180 },
  };
}
