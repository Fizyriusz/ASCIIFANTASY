/**
 * Klasyfikacja biomów.
 *
 * Biom nie jest osobną warstwą szumu — wynika z tego, co już policzyliśmy:
 * wysokości, nachylenia, wilgotności i bliskości wody. Dzięki temu las rośnie
 * tam, gdzie jest wilgotno i nie za stromo, a nie tam, gdzie wypadła plama
 * innego fBm-a nałożona na teren bez związku z nim.
 *
 * Przejścia są **rozmyte**: do wilgotności i temperatury dokładamy drobny szum
 * hashowany pozycją, więc granica biomu jest postrzępiona zamiast być prostą
 * linią. W ASCII ostra krawędź koloru czyta się jak błąd renderowania.
 */

import { rnd01, fbm } from './rng.js';
import { SEA_LEVEL, terrainHeight, terrainSlope } from './terrain.js';
import { carveHeight, riverSegments, waterAt } from './hydro.js';

export type BiomeId = number;

/** Kolejność musi odpowiadać `WildBiome` z paczki `wild`. */
export const Biome = {
  Meadow: 0,
  Broadleaf: 1,
  Conifer: 2,
  Heath: 3,
  Marsh: 4,
  RockyRidge: 5,
  Riverbank: 6,
  Beach: 7,
} as const;

/** komórki na cechę wilgotności ≈ 700 m */
const MOIST_FEATURE = 350;
/** metry: wysokość, powyżej której robi się chłodno */
const COLD_HEIGHT = 52;
/** nachylenie, powyżej którego zostaje goła skała */
const ROCK_SLOPE = 0.34;

/**
 * Wilgotność 0..1 z drobnym rozmyciem hashowanym pozycją.
 * Rozmycie jest celowo małe (±0.03) — ma postrzępić granicę, a nie zamienić
 * biomy w szum sól-pieprz.
 */
export function moistureAt(seed: number, wx: number, wy: number): number {
  const base = fbm(wx / MOIST_FEATURE, wy / MOIST_FEATURE, seed + 71, 4);
  return base + (rnd01(wx | 0, wy | 0, seed, 0x6d01) - 0.5) * 0.06;
}

/**
 * Klasyfikacja z gotowych wartości — tej wersji używa generator chunka, bo ma
 * już policzoną wysokość, nachylenie i wodę i nie ma powodu liczyć ich drugi raz.
 */
export function classifyBiome(
  seed: number,
  wx: number,
  wy: number,
  height: number,
  slope: number,
  water: number | null,
): BiomeId {
  if (water !== null) {
    // dno: piach przy morzu, żwir w rzece
    return height < SEA_LEVEL + 1 ? Biome.Beach : Biome.Riverbank;
  }

  const moist = moistureAt(seed, wx, wy);

  // brzeg: nisko nad lustrem morza — pas piasku
  if (height < SEA_LEVEL + 1.6) return Biome.Beach;

  if (slope > ROCK_SLOPE) return Biome.RockyRidge;

  // chłód rośnie z wysokością; ±0.02 szumu rozmywa granicę boru
  const cold =
    height / COLD_HEIGHT + (rnd01(wx | 0, wy | 0, seed, 0x1f7) - 0.5) * 0.04;

  if (height < 4 && moist > 0.58 && slope < 0.07) return Biome.Marsh;
  if (cold > 0.62 && moist > 0.42) return Biome.Conifer;
  if (moist > 0.55) return Biome.Broadleaf;
  if (moist < 0.36) return Biome.Heath;
  return Biome.Meadow;
}

/**
 * Wersja samodzielna: liczy wszystko od zera. Wygodna w testach i w narzędziach,
 * kosztowna w pętli — generator chunka używa `classifyBiome`.
 */
export function biomeAt(seed: number, wx: number, wy: number, chunkSize: number): BiomeId {
  const cx = Math.floor(wx / chunkSize);
  const cy = Math.floor(wy / chunkSize);
  const segs = riverSegments(seed, cx, cy, chunkSize);
  const ground = carveHeight(segs, wx, wy, terrainHeight(seed, wx, wy));
  const water = waterAt(segs, wx, wy, ground);
  return classifyBiome(seed, wx, wy, ground, terrainSlope(seed, wx, wy), water);
}
