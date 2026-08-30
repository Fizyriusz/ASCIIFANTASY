/**
 * Linia zdarzeń: dwie–trzy ostatnie rzeczy, które się stały, gasnące po sekundzie.
 *
 * Po co, skoro jest błysk i klatka trafienia: te dwa mówią, **że** coś się stało,
 * a nie **dlaczego**. „Przegrałem, bo zaatakowałem w odbiciu" jest zdaniem, nie
 * obrazem — a w medium bez dźwięku i bez cząsteczek tekst jest naturalnym kanałem
 * sprzężenia zwrotnego i idzie do tego samego bufora znaków co świat.
 *
 * Wpisy nazywają przyczynę, nie liczbę: „zablokowane" niesie decyzję, „−4 hp" nie.
 * Kolejka ma stałą długość i stałe miejsce w kadrze — to nie są unoszące się liczby
 * obrażeń, tylko dziennik.
 */

import { FEEDBACK } from '@rpg/content';
import { shade } from '@rpg/core';
import type { Screen } from '@rpg/core';

/** Waga wpisu: zwykłe zdarzenie, sukces gracza, cios w gracza. */
export const EventKind = {
  Neutral: 0,
  Good: 1,
  Bad: 2,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

const TINT: readonly [number, number, number][] = [
  [215, 210, 195],
  [130, 200, 120],
  [225, 110, 90],
];

export interface EventLog {
  /** najnowszy wpis jest ostatni */
  readonly text: string[];
  readonly kind: EventKind[];
  /** ms od dodania wpisu */
  readonly age: number[];
}

export function makeEventLog(): EventLog {
  return { text: [], kind: [], age: [] };
}

/**
 * Dodaje wpis. Powtórzenie tej samej treści **odświeża** istniejący wpis zamiast
 * dokładać drugi — inaczej seria trafień w wymianie ciosów wypycha z kolejki
 * wszystko, co ją poprzedzało, czyli dokładnie to, co gracz chciałby przeczytać.
 */
export function pushEvent(log: EventLog, text: string, kind: EventKind = EventKind.Neutral): void {
  const last = log.text.length - 1;
  if (last >= 0 && log.text[last] === text) {
    log.age[last] = 0;
    log.kind[last] = kind;
    return;
  }
  log.text.push(text);
  log.kind.push(kind);
  log.age.push(0);
  while (log.text.length > FEEDBACK.logLines) {
    log.text.shift();
    log.kind.shift();
    log.age.shift();
  }
}

/** Postarza wpisy i usuwa wygasłe. Najstarszy gaśnie pierwszy. */
export function tickLog(log: EventLog, dtMs: number): void {
  for (let i = 0; i < log.age.length; i++) log.age[i] = (log.age[i] ?? 0) + dtMs;
  while (log.age.length > 0 && (log.age[0] ?? 0) > FEEDBACK.logFadeMs) {
    log.text.shift();
    log.kind.shift();
    log.age.shift();
  }
}

/**
 * Rysuje dziennik w dół od wiersza `y`, najnowszy wpis na dole. Jasność spada
 * z wiekiem, więc świeże zdarzenie odróżnia się od tego sprzed sekundy bez
 * dokładania drugiego kanału informacji.
 */
export function drawLog(s: Screen, x: number, y: number, log: EventLog): void {
  const n = log.text.length;
  for (let i = 0; i < n; i++) {
    const wiek = log.age[i] ?? 0;
    const swiezosc = 1 - wiek / FEEDBACK.logFadeMs;
    if (swiezosc <= 0) continue;
    const t = TINT[log.kind[i] ?? 0] ?? TINT[0]!;
    // 0,35 to podłoga jasności: wpis ma gasnąć, ale do końca być czytelny
    const lum = 0.35 + 0.65 * swiezosc;
    s.text(x, y - (n - 1 - i), log.text[i] ?? '', shade(t[0], t[1], t[2], lum));
  }
}
