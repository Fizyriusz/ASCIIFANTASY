/**
 * Siatka spanów trzymana w pamięci — magazyn na potrzeby M0.
 *
 * To NIE jest generacja proceduralna: chunki, streaming i warstwy generacji to
 * M1. Tutaj chodzi wyłącznie o to, żeby renderer miał na czym pracować i żeby
 * dało się ręcznie ustawić komórkę z mostem albo sufitem.
 *
 * Zawijanie współrzędnych maską (rozmiar = potęga dwójki) jak w prototypie:
 * świat testowy jest przez to nieskończony, a renderer nie ma ani jednego
 * warunku brzegowego — DDA może iść w dowolną stronę dowolnie długo.
 *
 * Układ pamięci: tablice równoległe o stałej pojemności na komórkę, nie tablice
 * obiektów. Powód ten sam co w ColumnHits — renderer czyta te dane 150 × 48 razy
 * na klatkę i każdy `Span` jako obiekt to praca dla GC.
 */

import type { RenderTarget } from '@rpg/core';
import type { MaterialId, Span, SpanFlagMask } from './types.js';
import { SpanFlags } from './types.js';
import { h32, mulberry32, vnoise } from './rng.js';

/**
 * Ile spanów mieści komórka. Cztery wystarczają na teren + budynek + most +
 * sufit; średnia w terenie otwartym ma być ≤ 1.3, więc to zapas, nie norma.
 */
export const MAX_SPANS_PER_CELL = 4;

function isPow2(v: number): boolean {
  return v > 0 && (v & (v - 1)) === 0;
}

export class SpanGrid implements RenderTarget {
  readonly width: number;
  readonly height: number;
  private readonly maskX: number;
  private readonly maskY: number;
  private readonly counts: Uint8Array;
  private readonly bottoms: Float64Array;
  private readonly tops: Float64Array;
  private readonly mats: Int32Array;
  private readonly capMats: Int32Array;
  private readonly spanFlags: Int32Array;
  private readonly lights: Uint8Array;

  constructor(width: number, height: number) {
    if (!isPow2(width) || !isPow2(height)) {
      throw new Error(`SpanGrid: rozmiar musi być potęgą dwójki, dostał ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.maskX = width - 1;
    this.maskY = height - 1;
    const cells = width * height;
    const slots = cells * MAX_SPANS_PER_CELL;
    this.counts = new Uint8Array(cells);
    this.bottoms = new Float64Array(slots);
    this.tops = new Float64Array(slots);
    this.mats = new Int32Array(slots);
    this.capMats = new Int32Array(slots);
    this.spanFlags = new Int32Array(slots);
    this.lights = new Uint8Array(cells);
    this.lights.fill(15);
  }

  private index(cx: number, cy: number): number {
    return (cy & this.maskY) * this.width + (cx & this.maskX);
  }

  /**
   * Ustawia zawartość komórki. Spany lądują posortowane rosnąco po `bottom` —
   * renderer zakłada ten porządek i przechodzi listę od góry albo od dołu
   * zależnie od tego, który front wypełnia.
   */
  setColumn(cx: number, cy: number, spans: readonly Span[]): void {
    const cell = this.index(cx, cy);
    const base = cell * MAX_SPANS_PER_CELL;
    const count = spans.length > MAX_SPANS_PER_CELL ? MAX_SPANS_PER_CELL : spans.length;
    for (let i = 0; i < count; i++) {
      const s = spans[i];
      if (s === undefined) continue;
      this.bottoms[base + i] = s.bottom;
      this.tops[base + i] = s.top;
      this.mats[base + i] = s.mat;
      this.capMats[base + i] = s.capMat;
      this.spanFlags[base + i] = s.flags;
    }
    this.counts[cell] = count;

    // sortowanie przez wstawianie — n ≤ 4, a wejściowej tablicy nie ruszamy
    for (let i = 1; i < count; i++) {
      const b = this.bottoms[base + i] ?? 0;
      const t = this.tops[base + i] ?? 0;
      const m = this.mats[base + i] ?? 0;
      const cm = this.capMats[base + i] ?? 0;
      const f = this.spanFlags[base + i] ?? 0;
      let j = i - 1;
      while (j >= 0 && (this.bottoms[base + j] ?? 0) > b) {
        this.bottoms[base + j + 1] = this.bottoms[base + j] ?? 0;
        this.tops[base + j + 1] = this.tops[base + j] ?? 0;
        this.mats[base + j + 1] = this.mats[base + j] ?? 0;
        this.capMats[base + j + 1] = this.capMats[base + j] ?? 0;
        this.spanFlags[base + j + 1] = this.spanFlags[base + j] ?? 0;
        j--;
      }
      this.bottoms[base + j + 1] = b;
      this.tops[base + j + 1] = t;
      this.mats[base + j + 1] = m;
      this.capMats[base + j + 1] = cm;
      this.spanFlags[base + j + 1] = f;
    }
  }

  setLight(cx: number, cy: number, value: number): void {
    this.lights[this.index(cx, cy)] = value < 0 ? 0 : value > 15 ? 15 : value | 0;
  }

  /**
   * Wysokość powierzchni, po której da się chodzić: najwyższa czapka nie wyżej
   * niż `maxZ`. Zwraca -Infinity, gdy pod tym pułapem nie ma na czym stanąć.
   */
  surfaceHeight(cx: number, cy: number, maxZ: number): number {
    const cell = this.index(cx, cy);
    const base = cell * MAX_SPANS_PER_CELL;
    const n = this.counts[cell] ?? 0;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const t = this.tops[base + i] ?? 0;
      if (t <= maxZ && t > best) best = t;
    }
    return best;
  }

  /** Czy odcinek wysokości [z0, z1) koliduje z jakąkolwiek bryłą w komórce. */
  blocks(cx: number, cy: number, z0: number, z1: number): boolean {
    const cell = this.index(cx, cy);
    const base = cell * MAX_SPANS_PER_CELL;
    const n = this.counts[cell] ?? 0;
    for (let i = 0; i < n; i++) {
      if ((this.tops[base + i] ?? 0) > z0 && (this.bottoms[base + i] ?? 0) < z1) return true;
    }
    return false;
  }

  spanCount(cx: number, cy: number): number {
    return this.counts[this.index(cx, cy)] ?? 0;
  }

  spanTop(cx: number, cy: number, i: number): number {
    return this.tops[this.index(cx, cy) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanBottom(cx: number, cy: number, i: number): number {
    return this.bottoms[this.index(cx, cy) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanMaterial(cx: number, cy: number, i: number): number {
    return this.mats[this.index(cx, cy) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanCapMaterial(cx: number, cy: number, i: number): number {
    return this.capMats[this.index(cx, cy) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanFlagsAt(cx: number, cy: number, i: number): number {
    return this.spanFlags[this.index(cx, cy) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  light(cx: number, cy: number): number {
    return this.lights[this.index(cx, cy)] ?? 15;
  }
}

/* ------------------------------------------------------------------ *
 * Miasto testowe. Tymczasowe — w M1 zastąpi je generacja warstwowa.
 * ------------------------------------------------------------------ */

/** Materiały: indeksy do MATERIALS z @rpg/core. Trzymane lokalnie, żeby nie
 *  wiązać generacji z enumem renderera na tym etapie. */
const MAT_STONE = 0;
const MAT_PLASTER = 1;
const MAT_GLASS = 2;
const MAT_ASPHALT = 3;
const MAT_PAVEMENT = 4;
const MAT_GRASS = 5;
const MAT_WOOD = 7;
const MAT_LAMP = 9;

const CITY_SIZE = 64;
/** ulice co 8 komórek, aleje co 32 — układ z prototypu */
const BLOCK = 8;
const AVENUE = 32;

function isRoad(x: number, y: number): boolean {
  return (
    (x & (BLOCK - 1)) === 0 ||
    (y & (BLOCK - 1)) === 0 ||
    (x > 0 && (x - 1) % AVENUE === 0) ||
    (y > 0 && (y - 1) % AVENUE === 0)
  );
}

function span(
  bottom: number,
  top: number,
  mat: MaterialId,
  capMat: MaterialId,
  flags: SpanFlagMask,
): Span {
  return { bottom, top, mat, capMat, flags };
}

/**
 * Odtwarza układ z prototypu: siatka ulic, chodniki przy jezdni, kwartały
 * budynków 1–3 komórek, wysokości z szumu. Świadomie prymitywne — jedyne, co
 * musi być prawdą, to determinizm i sensowne proporcje do oglądania renderera.
 */
export function buildTestCity(seed: number): SpanGrid {
  const grid = new SpanGrid(CITY_SIZE, CITY_SIZE);

  // 1. teren: jezdnia, chodnik, trawnik działki
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      const road = isRoad(x, y);
      const nextToRoad =
        !road &&
        (isRoad(x + 1, y) || isRoad(x - 1, y) || isRoad(x, y + 1) || isRoad(x, y - 1));
      const capMat = road ? MAT_ASPHALT : nextToRoad ? MAT_PAVEMENT : MAT_GRASS;
      const topZ = road ? 0 : nextToRoad ? 0.2 : 0.15;
      grid.setColumn(x, y, [span(-4, topZ, MAT_STONE, capMat, SpanFlags.Solid)]);
    }
  }

  // 2. budynki na działkach — kwartały 1–3 komórek, wysokość z gęstości dzielnicy
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      if (isRoad(x, y)) continue;
      if (isRoad(x + 1, y) || isRoad(x - 1, y) || isRoad(x, y + 1) || isRoad(x, y - 1)) continue;
      if (grid.spanCount(x, y) > 1) continue; // już zabudowane przez sąsiada

      const lot = mulberry32(h32(x, y, seed, 5));
      if (lot() < 0.12) continue; // pusta działka / skwer

      const density = vnoise(x / 26, y / 26, seed + 3);
      const w = 1 + ((lot() * 3) | 0);
      const d = 1 + ((lot() * 3) | 0);
      const height = 4 + Math.pow(density, 2.2) * 34 * (0.4 + 0.6 * lot());
      const wallMat = lot() < 0.35 ? MAT_GLASS : lot() < 0.7 ? MAT_PLASTER : MAT_STONE;

      for (let dy = 0; dy < d; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const bx = x + dx;
          const by = y + dy;
          if (bx >= CITY_SIZE || by >= CITY_SIZE) continue;
          if (isRoad(bx, by)) continue;
          if (isRoad(bx + 1, by) || isRoad(bx - 1, by) || isRoad(bx, by + 1) || isRoad(bx, by - 1)) {
            continue;
          }
          if (grid.spanCount(bx, by) > 1) continue;
          grid.setColumn(bx, by, [
            span(-4, 0.15, MAT_STONE, MAT_GRASS, SpanFlags.Solid),
            span(0.15, height, wallMat, MAT_STONE, SpanFlags.Solid),
          ]);
          grid.setLight(bx, by, 12);
        }
      }
    }
  }

  // 3. latarnie — pojedyncze świecące słupki na chodniku, co szesnastą komórkę
  for (let y = 0; y < CITY_SIZE; y++) {
    for (let x = 0; x < CITY_SIZE; x++) {
      if (isRoad(x, y) || grid.spanCount(x, y) > 1) continue;
      if ((x & 15) !== 4 || (y & 15) !== 4) continue;
      grid.setColumn(x, y, [
        span(-4, 0.2, MAT_STONE, MAT_PAVEMENT, SpanFlags.Solid),
        span(0.2, 4.2, MAT_LAMP, MAT_LAMP, SpanFlags.Solid | SpanFlags.Emissive),
      ]);
    }
  }

  // 4. kładka nad aleją — jedyny element, którego prototyp nie umiał pokazać;
  //    stoi tu po to, żeby model spanów było widać w żywej aplikacji, nie tylko
  //    w snapshocie testowym
  const bridgeY = 32;
  for (let x = 28; x <= 36; x++) {
    grid.setColumn(x, bridgeY, [
      span(-4, isRoad(x, bridgeY) ? 0 : 0.2, MAT_STONE, MAT_ASPHALT, SpanFlags.Solid),
      span(5, 5.8, MAT_WOOD, MAT_WOOD, SpanFlags.Solid),
    ]);
  }
  return grid;
}
