/**
 * Roślinność i drobne bryły terenu.
 *
 * Czysty hash pozycji, zero pamięci: drzewo nie jest nigdzie zapisane, tylko
 * wyliczane z `(seed, komórka)` za każdym razem, gdy chunk wchodzi do pamięci.
 * Wycięcie drzewa będzie deltą, a nie modyfikacją listy obiektów.
 *
 * Drzewo to **dwa spany**: pień i korona. Jeden span daje pionowy słupek jednego
 * materiału, czyli dokładnie to, co w M0 wyglądało jak latarnia — a las ma się
 * czytać jako las, nie jako palisada.
 */

import type { BiomeDef, PropDef } from '@rpg/content';
import { rnd01 } from './rng.js';

/** Wynik zapytania o rekwizyt. Wypełniany w miejscu — generacja nie alokuje na komórkę. */
export interface PropPick {
  /** indeks do `ContentPack.props` */
  def: number;
  /** metry: pełna wysokość rekwizytu nad gruntem */
  height: number;
  /** metry: wysokość pnia; korona zaczyna się tutaj */
  trunkTop: number;
}

/** nachylenie, powyżej którego nic już nie rośnie — drzewo na ścianie wygląda źle */
const MAX_PROP_SLOPE = 0.42;

/**
 * Czy w tej komórce stoi rekwizyt. Wypełnia `out` i zwraca `true`, gdy tak.
 *
 * Trzy niezależne hashe: obecność, wybór gatunku, wysokość. Rozdzielenie ich
 * jest istotne — wspólny hash daje korelację „wysokie drzewa zawsze tego samego
 * gatunku", która na dużym obszarze rzuca się w oczy.
 */
export function propAt(
  seed: number,
  wx: number,
  wy: number,
  biome: BiomeDef,
  props: readonly PropDef[],
  slope: number,
  out: PropPick,
): boolean {
  if (biome.propDensity <= 0) return false;
  if (slope > MAX_PROP_SLOPE) return false;
  if (rnd01(wx, wy, seed, 0x9e37) >= biome.propDensity) return false;

  const list = biome.props;
  if (list.length === 0) return false;
  const pick = list[Math.floor(rnd01(wx, wy, seed, 0x2b1d) * list.length) % list.length];
  if (pick === undefined) return false;
  const def = props[pick];
  if (def === undefined) return false;

  const t = rnd01(wx, wy, seed, 0x51ab);
  const height = def.minHeight + (def.maxHeight - def.minHeight) * t;
  out.def = pick;
  out.height = height;
  out.trunkTop = height * def.trunkFraction;
  return true;
}
