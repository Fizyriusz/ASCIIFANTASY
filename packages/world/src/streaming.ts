/**
 * Pierścień chunków wokół kamery — świat większy niż pamięć.
 *
 * Dwie rzeczy są tu nieoczywiste i obie wynikają z budżetu klatki:
 *
 * 1. **Generacja jest amortyzowana**: `update` produkuje co najwyżej jeden chunk
 *    na wywołanie. Pętla „doładuj wszystko, czego brakuje" jest prostsza, ale
 *    kosztuje 8 ms × 16 chunków przy pierwszym kroku w nowy obszar i widać to
 *    jako zacinkę. Lepiej mieć chwilowo pustą krawędź świata.
 * 2. **Wyszukiwanie chunka jest O(1) i bez modulo w typowym przypadku**: DDA
 *    przechodzi komórki sąsiadujące, więc pamiętamy ostatnio trafiony chunk
 *    i sprawdzamy go najpierw. Dopiero pudło schodzi do tablicy 5×5.
 *
 * Brakujący chunk zwraca zero spanów — renderer sam zostawi w tym miejscu
 * czyste tło, bo tak samo zachowuje się przy pustej siatce.
 */

import type { RenderTarget } from '@rpg/core';
import type { ContentPack } from '@rpg/content';
import type { Cell, DeltaKey } from './types.js';
import { CHUNK_SIZE } from './types.js';
import { MAX_SPANS_PER_CELL } from './grid.js';
import { Chunk, generateChunk } from './chunk.js';

/** domyślny promień pierścienia w chunkach: 2 → siatka 5×5, czyli ~20 tys. komórek */
const DEFAULT_RING = 2;
/** log2(CHUNK_SIZE) — przesunięcie zamiast dzielenia, działa też dla ujemnych */
const CHUNK_SHIFT = 6;
const CHUNK_MASK = CHUNK_SIZE - 1;

function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

export class ChunkStore implements RenderTarget {
  private readonly seed: number;
  private readonly pack: ContentPack;
  /**
   * Promień pierścienia. Parametr, a nie stała, bo zasięg widzenia i zasięg
   * streamingu muszą rosnąć **razem**: przy `maxDepth` większym niż pierścień
   * promienie wychodzą w niezaładowany świat i widać pustkę, a pomiar kosztu
   * renderu robi się bezużyteczny, bo mierzy marsz po niczym.
   */
  private readonly ring: number;
  private readonly span: number;
  /** siatka SPAN×SPAN indeksowana modulo — pozycja w tablicy wynika z (cx, cy) */
  private readonly slots: (Chunk | undefined)[];
  private readonly deltas = new Map<DeltaKey, Partial<Cell>>();
  private centerX = 0;
  private centerY = 0;
  private last: Chunk | undefined;
  /** licznik wygenerowanych chunków — do testów i telemetrii */
  generated = 0;

  constructor(seed: number, pack: ContentPack, ring: number = DEFAULT_RING) {
    this.seed = seed;
    this.pack = pack;
    this.ring = ring;
    this.span = ring * 2 + 1;
    this.slots = new Array<Chunk | undefined>(this.span * this.span);
  }

  /**
   * Przesuwa pierścień za kamerą i dogenerowuje **jeden** brakujący chunk.
   * Zwraca `true`, jeśli coś wygenerowano — apps/game używa tego do telemetrii.
   */
  update(camera: { x: number; y: number }): boolean {
    const ccx = Math.floor(camera.x) >> CHUNK_SHIFT;
    const ccy = Math.floor(camera.y) >> CHUNK_SHIFT;
    if (ccx !== this.centerX || ccy !== this.centerY) {
      this.centerX = ccx;
      this.centerY = ccy;
      this.evictOutside();
    }

    // najbliższy brakujący chunk pierwszy — gracz patrzy głównie przed siebie,
    // ale krawędź za plecami też musi kiedyś powstać
    let bestDist = Infinity;
    let bestX = 0;
    let bestY = 0;
    let found = false;
    for (let dy = -this.ring; dy <= this.ring; dy++) {
      for (let dx = -this.ring; dx <= this.ring; dx++) {
        const cx = ccx + dx;
        const cy = ccy + dy;
        if (this.at(cx, cy) !== undefined) continue;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestX = cx;
          bestY = cy;
          found = true;
        }
      }
    }
    if (!found) return false;

    const chunk = generateChunk(this.seed, bestX, bestY, this.pack);
    this.applyDeltasTo(chunk);
    this.slots[this.slotIndex(bestX, bestY)] = chunk;
    this.generated++;
    return true;
  }

  /** Ładuje cały pierścień od razu — do testów i snapshotów, nigdy w pętli gry. */
  loadRing(camera: { x: number; y: number }): void {
    this.centerX = Math.floor(camera.x) >> CHUNK_SHIFT;
    this.centerY = Math.floor(camera.y) >> CHUNK_SHIFT;
    this.evictOutside();
    while (this.update(camera)) {
      /* aż pierścień będzie pełny */
    }
  }

  /**
   * Nadpisania z zapisu gry. Trzymamy je w całości, bo delta musi przeżyć
   * wyrzucenie chunka z pamięci — inaczej wykopany tunel zarasta po odejściu.
   */
  applyDeltas(deltas: Record<DeltaKey, Partial<Cell>>): void {
    for (const key of Object.keys(deltas) as DeltaKey[]) {
      const d = deltas[key];
      if (d !== undefined) this.deltas.set(key, d);
    }
    for (let i = 0; i < this.slots.length; i++) {
      const c = this.slots[i];
      if (c !== undefined) this.applyDeltasTo(c);
    }
  }

  private applyDeltasTo(chunk: Chunk): void {
    if (this.deltas.size === 0) return;
    for (const [key, delta] of this.deltas) {
      const parts = key.split(':');
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      const cell = Number(parts[2]);
      if (cx !== chunk.cx || cy !== chunk.cy) continue;
      if (cell < 0 || cell >= CHUNK_SIZE * CHUNK_SIZE) continue;
      if (delta.light !== undefined) chunk.lights[cell] = delta.light;
      const spans = delta.spans;
      if (spans !== undefined) {
        const base = cell * MAX_SPANS_PER_CELL;
        const n = spans.length > MAX_SPANS_PER_CELL ? MAX_SPANS_PER_CELL : spans.length;
        for (let i = 0; i < n; i++) {
          const s = spans[i];
          if (s === undefined) continue;
          chunk.bottoms[base + i] = s.bottom;
          chunk.tops[base + i] = s.top;
          chunk.mats[base + i] = s.mat;
          chunk.capMats[base + i] = s.capMat;
          chunk.spanFlags[base + i] = s.flags;
        }
        chunk.counts[cell] = n;
      }
    }
  }

  private slotIndex(cx: number, cy: number): number {
    return mod(cy, this.span) * this.span + mod(cx, this.span);
  }

  private at(cx: number, cy: number): Chunk | undefined {
    const c = this.slots[this.slotIndex(cx, cy)];
    if (c === undefined || c.cx !== cx || c.cy !== cy) return undefined;
    return c;
  }

  private evictOutside(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const c = this.slots[i];
      if (c === undefined) continue;
      if (
        Math.abs(c.cx - this.centerX) > this.ring ||
        Math.abs(c.cy - this.centerY) > this.ring
      ) {
        this.slots[i] = undefined;
        if (this.last === c) this.last = undefined;
      }
    }
  }

  /** Hot path: chunk dla komórki świata, z pamięcią ostatniego trafienia. */
  private chunkFor(cx: number, cy: number): Chunk | undefined {
    const ccx = cx >> CHUNK_SHIFT;
    const ccy = cy >> CHUNK_SHIFT;
    const l = this.last;
    if (l !== undefined && l.cx === ccx && l.cy === ccy) return l;
    const c = this.at(ccx, ccy);
    if (c !== undefined) this.last = c;
    return c;
  }

  spanCount(cx: number, cy: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return c.counts[(cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)] ?? 0;
  }

  spanTop(cx: number, cy: number, i: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return c.tops[((cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanBottom(cx: number, cy: number, i: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return (
      c.bottoms[((cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)) * MAX_SPANS_PER_CELL + i] ?? 0
    );
  }

  spanMaterial(cx: number, cy: number, i: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return c.mats[((cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)) * MAX_SPANS_PER_CELL + i] ?? 0;
  }

  spanCapMaterial(cx: number, cy: number, i: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return (
      c.capMats[((cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)) * MAX_SPANS_PER_CELL + i] ?? 0
    );
  }

  light(cx: number, cy: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 15;
    return c.lights[(cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)] ?? 15;
  }

  /** Biom komórki — poza kontraktem RenderTarget, używany przez logikę gry i testy. */
  biomeAtCell(cx: number, cy: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return 0;
    return c.biomes[(cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK)] ?? 0;
  }

  /**
   * Najwyższa czapka nie wyżej niż `maxZ` — po tym chodzi gracz.
   * Zwraca -Infinity, gdy komórka nie jest załadowana albo nie ma na czym stanąć.
   */
  surfaceHeight(cx: number, cy: number, maxZ: number): number {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return Number.NEGATIVE_INFINITY;
    const cell = (cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK);
    const n = c.counts[cell] ?? 0;
    const base = cell * MAX_SPANS_PER_CELL;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const t = c.tops[base + i] ?? 0;
      if (t <= maxZ && t > best) best = t;
    }
    return best;
  }

  /** Czy odcinek [z0, z1) koliduje z bryłą w komórce. Woda nie blokuje. */
  blocks(cx: number, cy: number, z0: number, z1: number): boolean {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return false;
    const cell = (cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK);
    const n = c.counts[cell] ?? 0;
    const base = cell * MAX_SPANS_PER_CELL;
    for (let i = 0; i < n; i++) {
      if ((c.spanFlags[base + i] ?? 0) & 2) continue; // SpanFlags.Water
      if ((c.tops[base + i] ?? 0) > z0 && (c.bottoms[base + i] ?? 0) < z1) return true;
    }
    return false;
  }

  /** Poziom wody w komórce albo null. Czytane ze spanu, nie liczone od nowa. */
  waterLevel(cx: number, cy: number): number | null {
    const c = this.chunkFor(cx, cy);
    if (c === undefined) return null;
    const cell = (cy & CHUNK_MASK) * CHUNK_SIZE + (cx & CHUNK_MASK);
    const n = c.counts[cell] ?? 0;
    const base = cell * MAX_SPANS_PER_CELL;
    for (let i = 0; i < n; i++) {
      if ((c.spanFlags[base + i] ?? 0) & 2) return c.tops[base + i] ?? null;
    }
    return null;
  }

  /** Liczba chunków w pamięci — test na wyciek. */
  get loaded(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i] !== undefined) n++;
    return n;
  }
}
