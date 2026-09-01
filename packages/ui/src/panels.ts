/**
 * Trzy panele M3: ekwipunek, karta postaci, ekran śmierci. Wszystkie rysują się
 * przez `panel.ts` — ramka, wiersz listy i pasek są jednym kodem, żeby czwarty panel
 * kosztował dziesięć linii, a nie sto.
 *
 * Panele nie znają stanu gry ani wejścia: dostają aktora, plecak i pozycję kursora,
 * i tylko rysują. Sterowanie jest w `apps/game`, bo to ono wie, co znaczy klawisz.
 */

import { armors, weapons } from '@rpg/content';
import type { Screen } from '@rpg/core';
import {
  Attr,
  weaponOf,
  armorOf,
  protectionOf,
  totalWeight,
  itemName,
  itemWeight,
  ItemKind,
} from '@rpg/rules';
import type { Actor, Inventory, InventoryItem } from '@rpg/rules';
import { UI, bar, centered, frame, listRow } from './panel.js';

const ATTR_NAMES = ['SIŁ', 'ZRĘ', 'KON', 'INT', 'WOL', 'CHA'] as const;
const SKILL_NAMES = ['ostrze', 'obuch', 'blok', 'unik', 'skradanie'] as const;

/**
 * Jednowierszowy opis przedmiotu. Liczby biorą się z contentu, więc zmiana balansu
 * zmienia to, co widać w plecaku, bez dotykania interfejsu.
 */
function statsOf(it: InventoryItem): string {
  if (it.kind === ItemKind.Weapon) {
    const w = weapons[it.index];
    return w === undefined ? '' : `${w.dmgMin}-${w.dmgMax} obr.`;
  }
  const a = armors[it.index];
  return a === undefined ? '' : `+${a.protection} panc.`;
}

/** Prostokąt panelu wyśrodkowany na ekranie o zadanych proporcjach. */
function box(s: Screen, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const cw = Math.min(w, s.cols - 2);
  const ch = Math.min(h, s.rows - 2);
  return { x: ((s.cols - cw) / 2) | 0, y: ((s.rows - ch) / 2) | 0, w: cw, h: ch };
}

/**
 * Ekwipunek. Waga jest na widoku razem z udźwigiem, bo bez niej lista przedmiotów
 * jest tylko listą — decyzją staje się dopiero wtedy, gdy widać, ile jeszcze wolno
 * unieść.
 */
export function drawInventory(s: Screen, a: Actor, inv: Inventory, cursor: number): void {
  const b = box(s, 54, 22);
  frame(s, b.x, b.y, b.w, b.h, 'EKWIPUNEK');

  const w = weaponOf(a);
  const ar = armorOf(a);
  s.text(b.x + 2, b.y + 2, 'w ręce:', UI.dim);
  s.text(b.x + 12, b.y + 2, w.name, UI.text);
  s.text(b.x + 2, b.y + 3, 'na sobie:', UI.dim);
  s.text(b.x + 12, b.y + 3, ar === null ? '—' : ar.name, UI.text);

  const udzwig = (a.attrs[Attr.Str] ?? 0) * 0.6;
  const kg = totalWeight(a);
  s.text(b.x + 2, b.y + 5, `obciążenie ${kg.toFixed(1)} / ${udzwig.toFixed(1)} kg`, UI.dim);
  bar(s, b.x + 30, b.y + 5, b.w - 32, kg, udzwig, kg > udzwig ? UI.bad : UI.good);

  s.text(b.x + 2, b.y + 7, 'w plecaku', UI.accent);
  const linie = b.h - 10;
  for (let i = 0; i < linie; i++) {
    const it = inv.items[i];
    const y = b.y + 8 + i;
    if (it === undefined) {
      if (i === 0) s.text(b.x + 4, y, '(pusto)', UI.dim);
      continue;
    }
    listRow(
      s,
      b.x + 2,
      y,
      b.w - 4,
      `${itemName(it)}  ${statsOf(it)}`,
      `${itemWeight(it).toFixed(1)} kg`,
      i === cursor,
    );
  }

  centered(s, b.x, b.y + b.h - 1, b.w, ' ENTER zakłada · Q zamyka ', UI.dim);
}

/** Karta postaci: atrybuty, umiejętności, zasoby. Bez rozdawania punktów. */
export function drawCharacter(s: Screen, a: Actor): void {
  const b = box(s, 54, 22);
  frame(s, b.x, b.y, b.w, b.h, 'KARTA POSTACI');

  s.text(b.x + 2, b.y + 2, 'zdrowie', UI.dim);
  bar(s, b.x + 12, b.y + 2, 20, a.hp, a.maxHp, UI.bad);
  s.text(b.x + 34, b.y + 2, `${Math.ceil(a.hp)} / ${a.maxHp}`, UI.text);

  s.text(b.x + 2, b.y + 3, 'wytrzym.', UI.dim);
  bar(s, b.x + 12, b.y + 3, 20, a.stamina, a.maxStamina, UI.good);
  s.text(b.x + 34, b.y + 3, `${Math.ceil(a.stamina)} / ${a.maxStamina}`, UI.text);

  s.text(b.x + 2, b.y + 5, 'atrybuty', UI.accent);
  for (let i = 0; i < ATTR_NAMES.length; i++) {
    const y = b.y + 6 + (i % 3);
    const x = b.x + 2 + (i < 3 ? 0 : 24);
    s.text(x, y, ATTR_NAMES[i] ?? '???', UI.dim);
    s.text(x + 5, y, String(a.attrs[i] ?? 0), UI.text);
  }

  s.text(b.x + 2, b.y + 10, 'umiejętności', UI.accent);
  for (let i = 0; i < SKILL_NAMES.length; i++) {
    const y = b.y + 11 + i;
    s.text(b.x + 4, y, SKILL_NAMES[i] ?? '?', UI.dim);
    s.text(b.x + 16, y, String(a.skills[i] ?? 0), UI.text);
    bar(s, b.x + 20, y, b.w - 24, a.skills[i] ?? 0, 100, UI.accent);
  }

  const w = weaponOf(a);
  s.text(b.x + 2, b.y + b.h - 4, `broń: ${w.name} (${w.dmgMin}-${w.dmgMax}, zużycie ${a.weaponWear.toFixed(0)}%)`, UI.text);
  s.text(b.x + 2, b.y + b.h - 3, `pancerz: ${armorOf(a)?.name ?? '—'} (redukcja ${protectionOf(a).toFixed(1)})`, UI.text);
  centered(s, b.x, b.y + b.h - 1, b.w, ' C zamyka ', UI.dim);
}

/**
 * Ekran śmierci. Mówi, co zabiło i ile trwała gra — bez tego śmierć jest komunikatem
 * o błędzie, a nie zakończeniem próby.
 */
export function drawDeath(s: Screen, przyczyna: string, hoursPlayed: number, hasSave: boolean): void {
  const b = box(s, 46, 11);
  frame(s, b.x, b.y, b.w, b.h, '', true);
  centered(s, b.x, b.y + 2, b.w, 'ZGINĄŁEŚ', UI.bad);
  centered(s, b.x, b.y + 4, b.w, przyczyna, UI.text);
  centered(s, b.x, b.y + 5, b.w, `przetrwałeś ${hoursPlayed.toFixed(1)} h`, UI.dim);
  centered(
    s,
    b.x,
    b.y + 7,
    b.w,
    hasSave ? 'R — wczytaj ostatni zapis' : 'brak zapisu; N — zacznij od nowa',
    UI.accent,
  );
}
