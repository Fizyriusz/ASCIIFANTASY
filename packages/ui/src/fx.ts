/**
 * Efekty na gotowym kadrze. Jedyny mieszkaniec tego pliku to przyciemnienie,
 * bo jedyny efekt, którego nie da się zrobić na poziomie pojedynczego bytu,
 * to reakcja **całego obrazu** — a taka jest odpowiedź na oberwanie.
 *
 * Uwaga na miarę: efekt obejmujący cały kadr zmienia każdą komórkę, więc snapshot
 * niczego o nim nie powie (każde porównanie „różni się" przejdzie). Mierzy się go
 * liczbą — spadkiem średniej luminancji — a snapshot robi się z klatki po wygaśnięciu,
 * żeby sprawdzić rzecz naprawdę groźną: czy kadr wraca do stanu sprzed trafienia.
 */

import type { Screen } from '@rpg/core';

/**
 * Mnoży jasność każdej zamalowanej komórki przez `k`. Działa wprost na spakowanych
 * barwach (15 bitów, po pięć na kanał), bez rozpakowywania do obiektów — to jest
 * jeden przebieg po buforze w pętli gry.
 */
export function dimScreen(s: Screen, k: number): void {
  const colors = s.colors;
  for (let i = 0; i < colors.length; i++) {
    const p = colors[i] ?? 0;
    if (p === 0) continue;
    const r = (((p >> 10) & 31) * k) | 0;
    const g = (((p >> 5) & 31) * k) | 0;
    const b = ((p & 31) * k) | 0;
    colors[i] = (r << 10) | (g << 5) | b;
  }
}
