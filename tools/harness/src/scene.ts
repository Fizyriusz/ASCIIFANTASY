/**
 * Sceny referencyjne dla snapshotów.
 *
 * Render jest tekstem, więc regresja graficzna to diff tekstowy — ale tylko
 * wtedy, gdy scena jest w 100% deterministyczna. Wszystko tutaj wynika z seeda
 * i stałych: żadnego czasu, żadnego Math.random(), żadnego rozmiaru okna.
 *
 * Sceny dzielą się na dwie rodziny:
 *
 * - **neon** — ręcznie zbudowane miasto z M0 i sceny dowodowe modelu spanów
 *   (most, wnętrze, pustka). Testują *renderer*, więc ich złote pliki są
 *   zamrożone od M0 i każda ich zmiana jest regresją, dopóki ktoś nie udowodni,
 *   że jest inaczej.
 * - **wild** — proceduralne pustkowie z M1 na `ChunkStore`. Testują *generację*.
 *
 * Współrzędne kamer dla `wild` nie są wymyślone: znalazła je wyszukiwarka
 * przechodząca teren dla seeda 4242 i szukająca miejsc o zadanych własnościach
 * (rzeka w zasięgu wzroku, gęsty las, grzbiet z widokiem w dolinę). Dlatego
 * wyglądają na przypadkowe — bo są konkretne.
 */

import { Screen, compileMaterials, createRenderContext } from '@rpg/core';
import type { Camera, Material, RenderContext } from '@rpg/core';
import { neonPack, NeonMat, wildPack } from '@rpg/content';
import {
  CELL_METERS,
  ChunkStore,
  SpanGrid,
  SpanFlags,
  buildNeonCity,
  carveHeight,
  riverSegments,
  terrainHeight,
} from '@rpg/world';
import type { Span } from '@rpg/world';

export const REFERENCE = {
  seed: 1337,
  camera: { x: 33.0, y: 32.5, eyeZ: 0.9, yaw: Math.PI / 2, pitch: 0.06, fov: (74 * Math.PI) / 180 },
  cols: 150,
  rows: 48,
} as const;

/** Seed pustkowia. Inny niż miejski, bo to inny świat, nie inna wersja tego samego. */
export const WILD_SEED = 4242;

/**
 * Proporcje komórki znakowej. Nie są dowolne: metrics.ts liczy cellW ≈ 0.601·fontPx
 * i cellH ≈ 1.04·fontPx, a stosunek cellW/cellH wchodzi wprost w Kv. Podanie tu
 * okrągłych 6/10 dałoby snapshoty o innych proporcjach niż realny render.
 */
export const CELL_W = 6.01;
export const CELL_H = 10.4;

const neonMaterials: readonly Material[] = compileMaterials(neonPack.materials);
const wildMaterials: readonly Material[] = compileMaterials(wildPack.materials);

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

function context(materials: readonly Material[], maxDepth: number, fogDist: number): RenderContext {
  return createRenderContext(materials, {
    cellW: CELL_W,
    cellH: CELL_H,
    metersPerCell: CELL_METERS,
    maxDepth,
    fogDist,
    ambient: 0.3,
  });
}

/**
 * Miasto: parametry zamrożone od M0. Złote pliki `ref-*` zależą od nich co do
 * bajta i nie ruszamy ich przy strojeniu pustkowia.
 */
export function referenceContext(): RenderContext {
  return context(neonMaterials, 64, 90);
}

/**
 * Pustkowie: te same liczby co w grze. Snapshot ma pokazywać to, co widzi gracz,
 * a nie osobno dostrojoną scenę testową.
 */
export function wildContext(): RenderContext {
  return context(wildMaterials, 200, 220);
}

export function referenceCity(): SpanGrid {
  return buildNeonCity(REFERENCE.seed);
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
      grid.setColumn(x, y, [span(-4, 0, NeonMat.Stone, NeonMat.Asphalt)]);
    }
  }
  // przęsło w poprzek ulicy, 4.0–4.6 m nad jezdnią
  for (let x = 10; x <= 22; x++) {
    grid.setColumn(x, 16, [
      span(-4, 0, NeonMat.Stone, NeonMat.Asphalt),
      span(4, 4.6, NeonMat.Wood, NeonMat.Wood),
    ]);
  }
  // filary po obu stronach
  for (const px of [10, 22]) {
    grid.setColumn(px, 16, [
      span(-4, 0, NeonMat.Stone, NeonMat.Asphalt),
      span(0, 4.6, NeonMat.Stone, NeonMat.Wood),
    ]);
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
      grid.setColumn(x, y, [span(-4, 0, NeonMat.Stone, NeonMat.Pavement)]);
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
          span(-4, 0, NeonMat.Stone, NeonMat.Wood),
          span(0, 3, NeonMat.Stone, NeonMat.Stone),
          span(3, 3.4, NeonMat.Wood, NeonMat.Stone),
        ]);
      } else {
        grid.setColumn(x, y, [
          span(-4, 0, NeonMat.Stone, NeonMat.Wood),
          span(3, 3.4, NeonMat.Wood, NeonMat.Stone),
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

/* ------------------------------------------------------------------ *
 * Pustkowie — sceny proceduralne z M1
 * ------------------------------------------------------------------ */

/** Wysokość gruntu z uwzględnieniem koryt rzek — kamera musi stać *na* terenie. */
export function wildGround(wx: number, wy: number): number {
  const segs = riverSegments(WILD_SEED, Math.floor(wx / 64), Math.floor(wy / 64), 64);
  return carveHeight(segs, wx, wy, terrainHeight(WILD_SEED, wx, wy));
}

function wildCamera(x: number, y: number, yaw: number, pitch: number): Camera {
  return { x, y, eyeZ: wildGround(x, y) + 1.7, yaw, pitch, fov: (74 * Math.PI) / 180 };
}

/**
 * Współrzędne znalezione wyszukiwarką po terenie seeda 4242 — każda spełnia
 * inne kryterium i razem pokrywają to, co M1 miało wyprodukować.
 */
export const WILD_VIEWS = {
  hills: { x: -483.5, y: 560.5, yaw: 0.9, pitch: 0.05 },
  forest: { x: -339.5, y: -699.5, yaw: 1.2, pitch: 0.04 },
  river: { x: 176.5, y: -624.5, yaw: 2.618, pitch: 0.02 },
  ridge: { x: 680.5, y: -627.5, yaw: 5.3, pitch: -0.12 },
  /** dokładnie na styku czterech chunków, w okolicy przecinanej przez rzekę */
  seam: { x: -320, y: 512, yaw: 0.7, pitch: 0.02 },
} as const;

export function wildScene(view: keyof typeof WILD_VIEWS): { store: ChunkStore; camera: Camera } {
  const v = WILD_VIEWS[view];
  const camera = wildCamera(v.x, v.y, v.yaw, v.pitch);
  // pierścień 3 jak w grze — przy zasięgu 200 komórek mniejszy oznaczałby
  // renderowanie pustki zamiast świata
  const store = new ChunkStore(WILD_SEED, wildPack, 3);
  store.loadRing(camera);
  return { store, camera };
}

/** Miasto z odłożonej paczki — dowód, że setting da się wymienić bez ruszania kodu. */
export function neonCityScene(): { grid: SpanGrid; camera: Camera } {
  return {
    grid: buildNeonCity(REFERENCE.seed),
    camera: { x: 33.0, y: 26.5, eyeZ: 1.7, yaw: Math.PI / 2, pitch: 0.1, fov: (74 * Math.PI) / 180 },
  };
}
