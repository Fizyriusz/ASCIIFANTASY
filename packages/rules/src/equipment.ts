/**
 * Ekwipunek: waga, dwa sloty, zużycie. Nic więcej — plecak z kategoriami i sortowaniem
 * to osobne zadanie, a bez wagi ekwipunek w ogóle nie jest decyzją.
 */

import { armors, weapons, WeaponSkill } from '@rpg/content';
import type { ArmorDef, WeaponDef } from '@rpg/content';
import type { Actor } from './actor.js';

/**
 * Pięści: broń, której nie ma w contencie, bo nie da się jej zdjąć, sprzedać ani
 * zepsuć. Dzięki niej reszta kodu nigdy nie musi pytać, czy broń istnieje.
 */
export const FISTS: WeaponDef = {
  id: 'fists',
  name: 'pięści',
  dmgMin: 1,
  dmgMax: 3,
  windupMs: 220,
  recoverMs: 240,
  stamina: 5,
  reachM: 1,
  weightKg: 0,
  skill: WeaponSkill.Blunt,
  wearPerHit: 0,
  view: ['  _  ', ' (#) ', '  |  '],
};

export function weaponOf(a: Actor): WeaponDef {
  return a.weapon === null ? FISTS : (weapons[a.weapon] ?? FISTS);
}

export function armorOf(a: Actor): ArmorDef | null {
  return a.armor === null ? null : (armors[a.armor] ?? null);
}

/** Ochrona po zużyciu: pancerz w strzępach nie chroni, ale nadal waży. */
export function protectionOf(a: Actor): number {
  const def = armorOf(a);
  if (def === null) return 0;
  return def.protection * (1 - a.armorWear / 100);
}

/**
 * Mnożnik obrażeń od zużycia broni. Schodzi najwyżej do połowy — broń rozpadająca
 * się do zera zamienia zużycie w licznik do zera zamiast w decyzję, kiedy naprawić.
 */
export function weaponWearFactor(a: Actor): number {
  return 1 - (a.weaponWear / 100) * 0.5;
}

/**
 * Zakłada broń. Zmienia **wyłącznie slot** — przenoszeniem przedmiotu między
 * plecakiem a ręką zajmuje się `inventory.ts`, bo `carriedKg` ma jedno źródło
 * prawdy i jest nim lista plecaka.
 */
export function equipWeapon(a: Actor, index: number | null): void {
  a.weapon = index;
  a.weaponWear = 0;
}

export function equipArmor(a: Actor, index: number | null): void {
  a.armor = index;
  a.armorWear = 0;
}

/** Łączna waga: niesione plus założone. Ta liczba idzie do udźwigu. */
export function totalWeight(a: Actor): number {
  return a.carriedKg + weaponOf(a).weightKg + (armorOf(a)?.weightKg ?? 0);
}
