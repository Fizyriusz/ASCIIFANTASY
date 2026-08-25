/**
 * Wnętrza naziemne: chata jako spany ze ścianami, stropem, drzwiami i oknem.
 *
 * Minimalna wersja pod M4 — bez mieszkańców i mebli. Jedyne, co ma udowodnić,
 * to że renderer radzi sobie z wejściem przez drzwi i z widokiem przez okno.
 *
 * Otwór drzwiowy i okno to **spany z materiałem przezroczystym**, a nie brak
 * spanu. Różnica jest istotna: brak spanu renderer widzi jako zwykłą przerwę
 * między bryłami i obsługuje ją dwoma frontami, natomiast span przezroczysty
 * jest jawnym sygnałem „ta kolumna ma dziurę w środku" i przełącza ją na maskę
 * pokrycia. Bez tego sygnału trzeba by zgadywać z geometrii, a otworu w ścianie
 * nie da się odróżnić od bryły z niebem nad nią.
 *
 * Drzwi od okna różnią się **wyłącznie kolizją** — przez jedno da się przejść,
 * przez drugie nie. Dla renderera to ten sam przypadek.
 */

import { h32, mulberry32 } from './rng.js';
import { terrainHeight, terrainSlope } from './terrain.js';

/** komórki między kandydatami na chatę */
const SPACING = 384;
const CHANCE = 0.5;
/** chata staje tylko na płaskim — inaczej połowa ścian wisi w powietrzu */
const MAX_SLOPE = 0.09;

/** metry, liczone od podłogi */
const WALL_TOP = 3;
const ROOF_TOP = 3.5;
const DOOR_SILL = 0.15;
const DOOR_HEAD = 2.1;
const WINDOW_SILL = 1;
const WINDOW_HEAD = 1.9;

export interface Structure {
  /** lewy dolny róg w komórkach świata */
  x: number;
  y: number;
  w: number;
  h: number;
  /** metry: poziom podłogi, wyrównany pod całą chatą */
  floorZ: number;
  /** komórka drzwi na ścianie południowej (y = structure.y) */
  doorX: number;
  /** komórka okna na ścianie wschodniej (x = structure.x + w - 1) */
  windowY: number;
}

const cache = new Map<string, Structure | null>();
const CACHE_LIMIT = 512;

/** Chata dla węzła siatki albo `null`, gdy węzeł pusty lub teren zbyt stromy. */
export function structureAt(seed: number, nx: number, ny: number): Structure | null {
  const key = `${seed}:${nx}:${ny}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let out: Structure | null = null;
  const rnd = mulberry32(h32(nx, ny, seed, 0x4b17));
  if (rnd() <= CHANCE) {
    const x = Math.round(nx * SPACING + rnd() * SPACING);
    const y = Math.round(ny * SPACING + rnd() * SPACING);
    if (terrainSlope(seed, x, y) <= MAX_SLOPE) {
      const w = 6 + Math.floor(rnd() * 3);
      const h = 5 + Math.floor(rnd() * 3);
      out = {
        x,
        y,
        w,
        h,
        floorZ: terrainHeight(seed, x, y),
        doorX: x + 1 + Math.floor(rnd() * (w - 2)),
        windowY: y + 1 + Math.floor(rnd() * (h - 2)),
      };
    }
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}

/** Chaty, które mogą sięgać danego prostokąta komórek. */
export function structuresNear(
  seed: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Structure[] {
  const out: Structure[] = [];
  const n0x = Math.floor(minX / SPACING) - 1;
  const n0y = Math.floor(minY / SPACING) - 1;
  const n1x = Math.floor(maxX / SPACING) + 1;
  const n1y = Math.floor(maxY / SPACING) + 1;
  for (let ny = n0y; ny <= n1y; ny++) {
    for (let nx = n0x; nx <= n1x; nx++) {
      const s = structureAt(seed, nx, ny);
      if (s !== null) out.push(s);
    }
  }
  return out;
}

/** Co komórka zawiera z punktu widzenia chaty. */
export const StructurePart = {
  None: 0,
  /** wnętrze: podłoga i strop */
  Interior: 1,
  /** ściana pełna */
  Wall: 2,
  /** otwór drzwiowy: próg, przezroczysta pustka, nadproże */
  Door: 3,
  /** okno: mur pod parapetem, przezroczysta pustka, mur nad */
  Window: 4,
} as const;

export type StructurePart = (typeof StructurePart)[keyof typeof StructurePart];

export interface StructureHit {
  part: StructurePart;
  floorZ: number;
  wallTop: number;
  roofTop: number;
  sill: number;
  head: number;
}

/**
 * Klasyfikuje komórkę względem chat. Zwraca `false`, gdy komórka jest poza
 * wszystkimi budynkami.
 */
export function structureAtCell(
  structs: readonly Structure[],
  wx: number,
  wy: number,
  out: StructureHit,
): boolean {
  for (let i = 0; i < structs.length; i++) {
    const s = structs[i];
    if (s === undefined) continue;
    if (wx < s.x || wx >= s.x + s.w || wy < s.y || wy >= s.y + s.h) continue;

    out.floorZ = s.floorZ;
    out.wallTop = s.floorZ + WALL_TOP;
    out.roofTop = s.floorZ + ROOF_TOP;
    out.sill = 0;
    out.head = 0;

    const onSouth = wy === s.y;
    const onNorth = wy === s.y + s.h - 1;
    const onWest = wx === s.x;
    const onEast = wx === s.x + s.w - 1;

    if (onSouth && wx === s.doorX) {
      out.part = StructurePart.Door;
      out.sill = s.floorZ + DOOR_SILL;
      out.head = s.floorZ + DOOR_HEAD;
      return true;
    }
    if (onEast && wy === s.windowY) {
      out.part = StructurePart.Window;
      out.sill = s.floorZ + WINDOW_SILL;
      out.head = s.floorZ + WINDOW_HEAD;
      return true;
    }
    out.part = onSouth || onNorth || onWest || onEast ? StructurePart.Wall : StructurePart.Interior;
    return true;
  }
  return false;
}
