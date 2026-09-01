/**
 * Własne akcje w kadrze: zamach, blok, unik i celownik.
 *
 * M3b dał sprzężenie z **cudzych** akcji — widać zamach goblina, trafienie i
 * wyczerpanie. Tu powstaje druga połowa: własne ciało. Blok, unik i cios to trzy
 * różne decyzje i mają wyglądać jak trzy różne rzeczy, bo inaczej jedyną informacją
 * o tym, co robi gracz, jest etykieta w rogu ekranu — czyli poza miejscem, w które
 * patrzy w walce.
 *
 * Wszystko idzie do tego samego bufora znaków co świat. Zero widżetów, zero HTML —
 * ta sama zasada co przy panelach i linii zdarzeń.
 */

import { COMBAT, FEEDBACK } from '@rpg/content';
import type { WeaponDef } from '@rpg/content';
import { shade } from '@rpg/core';
import type { Screen } from '@rpg/core';

/** Stan własnej postawy przekazany z gry. Rysowanie nie zna reguł. */
export interface SelfView {
  /** 0..1 — postęp zamachu; poniżej zera broń jest poza kadrem */
  windup: number;
  blocking: boolean;
  /**
   * 0..1 — ile zostało z okna uniku. Nie rysuje niczego: **unik jest ruchem**, a nie
   * znakiem, i widać go po tym, że świat jedzie w drugą stronę. Pole zostaje, bo gra
   * potrzebuje tej wartości do prędkości przesunięcia.
   */
  dodge: number;
  /** 0..1 — jasność w miejscu gracza; broń jest oświetlona jak reszta kadru */
  lum: number;
  weapon: WeaponDef;
}

const STAL = { r: 200, g: 205, b: 215 } as const;
const DREWNO = { r: 150, g: 120, b: 80 } as const;

/**
 * Broń wchodząca w kadr od dołu. Wysokość wynika z postępu zamachu, więc gracz uczy
 * się rytmu własnej broni patrząc, a nie licząc — sztylet wskakuje, maczuga wypływa.
 * W odbiciu (`windup < 0`) broni nie ma: odbicie jest karą i ma wyglądać jak
 * bezbronność, a nie jak druga faza animacji.
 */
export function drawSelf(s: Screen, v: SelfView): void {
  if (v.blocking) drawBlock(s, v);
  else if (v.windup >= 0) drawWeapon(s, v);
}

function drawWeapon(s: Screen, v: SelfView): void {
  const art = v.weapon.view;
  const h = art.length;
  if (h === 0) return;
  const w = art.reduce((m, l) => Math.max(m, l.length), 0);
  // pełny postęp wysuwa broń tak, że jej czubek sięga jednej trzeciej wysokości kadru
  const skok = Math.round((s.rows / 3 + h) * v.windup);
  const x0 = ((s.cols - w) / 2 + Math.round(s.cols * 0.12)) | 0;
  const y0 = s.rows - skok;
  const kolor = shade(STAL.r, STAL.g, STAL.b, v.lum);
  const kolorTrzon = shade(DREWNO.r, DREWNO.g, DREWNO.b, v.lum);
  if (kolor === 0 && kolorTrzon === 0) return; // w ciemności własnej broni nie widać

  for (let r = 0; r < h; r++) {
    const linia = art[r] ?? '';
    for (let c = 0; c < linia.length; c++) {
      const ch = linia.charCodeAt(c);
      if (ch === 32) continue;
      // trzonek (dolna trzecia rysunku) jest drewniany, reszta stalowa
      s.put(x0 + c, y0 + r, ch, r >= h - Math.max(1, (h / 3) | 0) ? kolorTrzon : kolor);
    }
  }
}

/**
 * Blok: **stan**, nie ruch, więc jego znak jest stały i szeroki — zasłona wzdłuż
 * dolnej krawędzi kadru. Wyraźnie inny od wchodzącej broni, bo gracz musi odróżniać
 * „trzymam gardę" od „zamachnąłem się".
 */
function drawBlock(s: Screen, v: SelfView): void {
  const kolor = shade(STAL.r, STAL.g, STAL.b, v.lum);
  if (kolor === 0) return;
  const y = s.rows - 6;
  const x0 = (s.cols * 0.25) | 0;
  const x1 = (s.cols * 0.75) | 0;
  for (let x = x0; x < x1; x++) s.put(x, y, 61, kolor); // '='
  s.put(x0 - 1, y, 91, kolor); // '['
  s.put(x1, y, 93, kolor); // ']'
  for (let x = x0 + 2; x < x1 - 2; x += 6) {
    s.put(x, y + 1, 124, kolor); // '|' — nity gardy, żeby zasłona nie była kreską
  }
}

/**
 * Celownik: minimalny znacznik w środku kadru, przygaszony. Od M3f pion decyduje
 * o trafieniu, więc gracz musi widzieć, gdzie mierzy — ale znacznik ma być punktem
 * odniesienia, a nie elementem, na który się patrzy.
 *
 * Wersja stała, bez reakcji na cel. Wariant reagujący (inny wygląd, gdy przeciwnik
 * jest w zasięgu i w łuku) pomaga, ale zabiera część decyzji — do rozstrzygnięcia
 * po obejrzeniu w grze.
 */
export function drawCrosshair(s: Screen, lum = 1): void {
  const kolor = shade(150, 155, 165, 0.55 * lum);
  if (kolor === 0) return;
  const cx = (s.cols / 2) | 0;
  const cy = (s.rows / 2) | 0;
  s.put(cx - 2, cy, 45, kolor); // '-'
  s.put(cx + 2, cy, 45, kolor);
  s.put(cx, cy - 1, 39, kolor); // '''
  s.put(cx, cy + 1, 46, kolor); // '.'
}

/** Postęp zamachu 0..1 z czasu postawy; poza zamachem zwraca -1. */
export function windupProgress(stanceMs: number, weapon: WeaponDef, swinging: boolean): number {
  if (!swinging) return -1;
  const p = 1 - stanceMs / weapon.windupMs;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Ile zostało z okna uniku, 0..1. */
export function dodgeProgress(dodgeMs: number): number {
  const p = dodgeMs / COMBAT.dodgeWindowMs;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Czas trzymania klatki trafienia — wystawiony, żeby gra nie powtarzała stałej. */
export const SELF_HOLD_MS = FEEDBACK.hitHoldMs;
