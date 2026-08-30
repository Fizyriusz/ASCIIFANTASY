/**
 * Panele rysowane **w tym samym buforze znaków** co świat. Zero HTML, zero drugiego
 * canvasu — inaczej po trzech panelach mamy dwa systemy interfejsu, dwa sposoby
 * skalowania i dwie definicje tego, gdzie jest środek ekranu.
 *
 * Ten plik jest wzorcem dla wszystkich następnych paneli: ramka, wiersz listy,
 * kursor i pasek. Panel, który rysuje sobie własne obramowanie znak po znaku,
 * jest błędem, nawet gdy wygląda tak samo.
 */

import { pack15 } from '@rpg/core';
import type { Screen } from '@rpg/core';

/** Znaki ramki. Podwójna kreska dla okna aktywnego, pojedyncza dla tła. */
const BOX_SINGLE = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' } as const;
const BOX_DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' } as const;

/**
 * Barwy interfejsu. Nie w `packages/content`, bo to nie jest balans ani setting —
 * to czytelność. Panel ma wyglądać tak samo w lochu i w mieście.
 */
export const UI = {
  frame: pack15(150, 140, 120),
  text: pack15(220, 215, 200),
  dim: pack15(120, 115, 105),
  accent: pack15(240, 205, 120),
  bad: pack15(210, 90, 70),
  good: pack15(120, 190, 110),
  /** tło panelu: spacje w tym kolorze zamalowują świat pod spodem */
  fill: pack15(15, 14, 13),
} as const;

/** Wypełnia prostokąt spacjami, żeby świat nie prześwitywał przez panel. */
export function fillRect(s: Screen, x: number, y: number, w: number, h: number): void {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) s.put(c, r, 32, UI.fill);
  }
}

/**
 * Ramka z opcjonalnym tytułem. Tytuł siedzi w górnej krawędzi, bo osobny wiersz
 * na nagłówek zjada trzy procent ekranu w pionie przy 48 wierszach.
 */
export function frame(
  s: Screen,
  x: number,
  y: number,
  w: number,
  h: number,
  title = '',
  active = true,
): void {
  const b = active ? BOX_DOUBLE : BOX_SINGLE;
  fillRect(s, x, y, w, h);
  const hc = b.h.charCodeAt(0);
  const vc = b.v.charCodeAt(0);
  for (let c = x + 1; c < x + w - 1; c++) {
    s.put(c, y, hc, UI.frame);
    s.put(c, y + h - 1, hc, UI.frame);
  }
  for (let r = y + 1; r < y + h - 1; r++) {
    s.put(x, r, vc, UI.frame);
    s.put(x + w - 1, r, vc, UI.frame);
  }
  s.put(x, y, b.tl.charCodeAt(0), UI.frame);
  s.put(x + w - 1, y, b.tr.charCodeAt(0), UI.frame);
  s.put(x, y + h - 1, b.bl.charCodeAt(0), UI.frame);
  s.put(x + w - 1, y + h - 1, b.br.charCodeAt(0), UI.frame);
  if (title !== '') s.text(x + 2, y, ` ${title} `, UI.accent);
}

/**
 * Wiersz listy z kursorem. Kursor jest znakiem, a nie inwersją koloru: inwersja
 * w buforze znakowym wymagałaby drugiego kanału na komórkę, a znak `>` czyta się
 * jednoznacznie także na zrzucie tekstowym w teście.
 */
export function listRow(
  s: Screen,
  x: number,
  y: number,
  w: number,
  label: string,
  right = '',
  selected = false,
  color = UI.text,
): void {
  s.put(x, y, selected ? 62 : 32, UI.accent);
  const maxLabel = w - 2 - right.length - 1;
  s.text(x + 2, y, label.length > maxLabel ? label.slice(0, maxLabel) : label, color);
  if (right !== '') s.text(x + w - right.length, y, right, UI.dim);
}

/**
 * Pasek zasobu. Wypełnienie jest znakiem `#`, a nie blokiem `█`, bo pasek stoi
 * obok tekstu i musi mieć to samo pokrycie atramentem — inaczej oko czyta go jako
 * migotanie przy każdej zmianie wartości.
 */
export function bar(
  s: Screen,
  x: number,
  y: number,
  w: number,
  value: number,
  max: number,
  color: number,
): void {
  const frac = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const pelne = Math.round(frac * w);
  for (let c = 0; c < w; c++) {
    s.put(x + c, y, c < pelne ? 35 : 46, c < pelne ? color : UI.dim);
  }
}

/** Tekst wyśrodkowany w podanym przedziale kolumn. */
export function centered(s: Screen, x: number, y: number, w: number, text: string, color: number): void {
  s.text(x + Math.max(0, ((w - text.length) / 2) | 0), y, text, color);
}
