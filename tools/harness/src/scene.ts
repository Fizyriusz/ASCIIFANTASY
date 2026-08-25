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

import { Screen, addSource, clearSources, compileMaterials, createRenderContext } from '@rpg/core';
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

/* ------------------------------------------------------------------ *
 * M2 — podziemia, wnętrza i światło
 * ------------------------------------------------------------------ */

/**
 * Kontekst nocny i podziemny: mnożnik pory dnia zero. Nie jest to przesada — cała
 * mechanika eksploracji lochu polega na tym, że bez pochodni nie widać nic,
 * a „odrobina światła dla wygody" kasuje ją w całości.
 */
export function darkContext(): RenderContext {
  const ctx = context(wildMaterials, 200, 220);
  ctx.light.daylight = wildPack.light.daylightNight;
  return ctx;
}

/** Zapala pochodnię gracza w pozycji kamery. Migotanie ustawione na spokojny płomień. */
export function lightTorch(ctx: RenderContext, camera: Camera): void {
  ctx.light.torchX = camera.x * CELL_METERS;
  ctx.light.torchY = camera.y * CELL_METERS;
  ctx.light.torchZ = camera.eyeZ;
  ctx.light.torchRadius = wildPack.light.torchRadius;
  ctx.light.torchPower = wildPack.light.torchPower;
  ctx.light.torchFlicker = 1;
}

/**
 * Sceny podziemne. Współrzędne pochodzą z lochu w węźle (-1,-1) seeda 4242 —
 * wypisanego przez sondę, nie wymyślonego: łańcuch schodzi z 18,4 m przy wejściu
 * na -2,6 m na czwartym poziomie.
 *
 * Wysokości podłogi tu nie ma celowo. Bierzemy ją ze spanu zerowego komórki,
 * bo bieg schodów zmienia poziom co komórkę, a wpisana ręcznie liczba raz już
 * ustawiła kamerę w litej skale.
 */
export const DUNGEON_VIEWS = {
  /** bieg schodów pierwszego poziomu, kamera patrzy w dół biegu */
  corridor: { x: -157.5, y: -441.5, yaw: Math.PI, pitch: -0.12 },
  /** największa komora lochu, na dnie — jedyna scena podziemna ze światłem statycznym */
  room: { x: -222.5, y: -443.5, yaw: 0, pitch: 0 },
  /** długi prosty korytarz: widać, gdzie kończy się zasięg pochodni */
  torch: { x: -155.5, y: -440.5, yaw: Math.PI / 2, pitch: -0.1 },
  /**
   * Wejście z trzydziestu metrów, w dzień. Scena kontrolna punktu orientacyjnego:
   * bez skalnego obrzeża i brył łuku wcięcie jest z tej odległości ciemną plamą
   * nieodróżnialną od cienia pod drzewem.
   */
  approach: { x: -178.5, y: -412.5, yaw: -Math.PI / 2, pitch: -0.06 },
  /**
   * Wejście oglądane **od środka**: ciemny tunel dookoła, jasne wcięcie przed
   * nami. Od zewnątrz ten sam kadr się nie udaje — rampa wchodzi w zbocze
   * szybciej, niż opada strop, więc z dziesięciu metrów widać już tylko skarpę.
   */
  mouth: { x: -170.5, y: -426.5, yaw: Math.PI, pitch: 0 },
} as const;

/**
 * Loch albo otwór jaskini. `sources` wstawia żagwie do zestawu świateł —
 * po jednej na róg komory, żeby było widać, że oświetlenie dynamiczne sumuje się
 * z kilku źródeł, a nie tylko z pochodni.
 */
export function dungeonScene(
  view: keyof typeof DUNGEON_VIEWS,
  opts?: { torch?: boolean; sources?: boolean },
): { store: ChunkStore; camera: Camera; ctx: RenderContext } {
  const v = DUNGEON_VIEWS[view];
  const store = new ChunkStore(WILD_SEED, wildPack, 2);
  store.loadRing({ x: v.x, y: v.y });
  const cx = Math.floor(v.x);
  const cy = Math.floor(v.y);
  // podłoga to najniższy span komórki — na schodach i w wcięciu zmienia się
  // co komórkę, więc jedyna wiarygodna wartość jest odczytana, nie wpisana
  const floor = store.spanTop(cx, cy, 0);
  const camera: Camera = {
    x: v.x,
    y: v.y,
    eyeZ: floor + 1.7,
    yaw: v.yaw,
    pitch: v.pitch,
    fov: (74 * Math.PI) / 180,
  };
  const ctx = darkContext();
  clearSources(ctx.light);
  if (opts?.sources === true) {
    const p = wildPack.light;
    addSource(ctx.light, (v.x - 2) * CELL_METERS, (v.y - 1) * CELL_METERS, floor + 2, p.sourceRadius, p.sourcePower);
    addSource(ctx.light, (v.x + 3) * CELL_METERS, (v.y + 2) * CELL_METERS, floor + 2, p.sourceRadius, p.sourcePower);
  }
  if (opts?.torch !== false) lightTorch(ctx, camera);
  return { store, camera, ctx };
}

/**
 * Chata: widok przez otwarte drzwi z zewnątrz i widok przez okno od środka.
 * To są sceny dowodowe maski pokrycia — bez niej za otworem byłaby ściana.
 */
export const HUT = { x: -47, y: 138, doorX: -44, windowX: -42, windowY: 139, floorZ: 6.9 } as const;

export function hutScene(view: 'door' | 'window'): {
  store: ChunkStore;
  camera: Camera;
  ctx: RenderContext;
} {
  const store = new ChunkStore(WILD_SEED, wildPack, 2);
  const camera: Camera =
    view === 'door'
      ? // trzy komórki przed drzwiami, na wprost otworu
        {
          x: HUT.doorX + 0.5,
          y: HUT.y - 3.5,
          eyeZ: HUT.floorZ + 1.7,
          yaw: Math.PI / 2,
          pitch: 0,
          fov: (74 * Math.PI) / 180,
        }
      : // w środku izby, twarzą do okna w ścianie wschodniej
        {
          x: HUT.x + 2.5,
          y: HUT.windowY + 0.5,
          eyeZ: HUT.floorZ + 1.7,
          yaw: 0,
          pitch: 0,
          fov: (74 * Math.PI) / 180,
        };
  store.loadRing(camera);
  const ctx = wildContext();
  clearSources(ctx.light);
  return { store, camera, ctx };
}

/** Pustkowie nocą: ten sam teren co `wild-hills`, ale bez światła dziennego. */
export function nightScene(): { store: ChunkStore; camera: Camera; ctx: RenderContext } {
  const s = wildScene('hills');
  const ctx = darkContext();
  clearSources(ctx.light);
  lightTorch(ctx, s.camera);
  return { store: s.store, camera: s.camera, ctx };
}

/** Miasto z odłożonej paczki — dowód, że setting da się wymienić bez ruszania kodu. */
export function neonCityScene(): { grid: SpanGrid; camera: Camera } {
  return {
    grid: buildNeonCity(REFERENCE.seed),
    camera: { x: 33.0, y: 26.5, eyeZ: 1.7, yaw: Math.PI / 2, pitch: 0.1, fov: (74 * Math.PI) / 180 },
  };
}
