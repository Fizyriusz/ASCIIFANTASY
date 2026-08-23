/**
 * Siatka spanów trzymana w pamięci — mały, ręcznie zapełniany świat.
 *
 * Po M1 generacja właściwa mieszka w `chunk.ts` i `streaming.ts`; ta klasa
 * zostaje jako magazyn do scen testowych i do paczki `neon`, gdzie świat jest
 * skończony i budowany wprost, a nie streamowany.
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
import type { Span } from './types.js';

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
