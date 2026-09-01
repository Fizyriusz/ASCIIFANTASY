/**
 * Plecak: lista przedmiotów i ich waga. Bez kategorii, sortowania i stosów —
 * wszystkie trzy dokładają kod, a żadna nie dokłada decyzji, dopóki nie ma handlu
 * (M4).
 *
 * Waga aktora jest **wyliczana z listy**, a nie dopisywana przy każdej zmianie.
 * Dwa źródła prawdy o tej samej liczbie rozjeżdżają się przy pierwszym wyjątku
 * w kodzie, który je aktualizuje.
 */

import { armors, weapons } from '@rpg/content';
import type { Actor } from './actor.js';

export const ItemKind = {
  Weapon: 0,
  Armor: 1,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

export interface InventoryItem {
  kind: ItemKind;
  /** indeks w `weapons` albo `armors`, zależnie od `kind` */
  index: number;
}

export interface Inventory {
  items: InventoryItem[];
}

export function makeInventory(): Inventory {
  return { items: [] };
}

export function itemName(it: InventoryItem): string {
  return it.kind === ItemKind.Weapon
    ? (weapons[it.index]?.name ?? '?')
    : (armors[it.index]?.name ?? '?');
}

export function itemWeight(it: InventoryItem): number {
  return it.kind === ItemKind.Weapon
    ? (weapons[it.index]?.weightKg ?? 0)
    : (armors[it.index]?.weightKg ?? 0);
}

export function addItem(inv: Inventory, kind: ItemKind, index: number, owner: Actor): void {
  inv.items.push({ kind, index });
  syncWeight(inv, owner);
}

/** Usuwa przedmiot z listy i zwraca go, albo `null`, gdy indeks jest poza listą. */
export function removeItem(inv: Inventory, at: number, owner: Actor): InventoryItem | null {
  if (at < 0 || at >= inv.items.length) return null;
  const [it] = inv.items.splice(at, 1);
  syncWeight(inv, owner);
  return it ?? null;
}

/** Przelicza `carriedKg` z listy. Jedyne miejsce, które tę liczbę ustawia. */
export function syncWeight(inv: Inventory, owner: Actor): void {
  let kg = 0;
  for (const it of inv.items) kg += itemWeight(it);
  owner.carriedKg = kg;
}
