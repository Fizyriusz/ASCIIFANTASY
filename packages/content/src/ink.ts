/**
 * Pokrycie atramentem: ile powierzchni komórki zajmuje dany glif, 0..1.
 *
 * Potrzebne, bo oko nie reaguje na to, **ile** komórek zmieniło znak, tylko na
 * to, **jak mocno** zmienił się obraz. Sto komórek przechodzących z `%` na `"`
 * jest praktycznie niewidoczne; dziesięć kęp `W` mrugających na łące wygląda jak
 * stroboskop. Metryka licząca same zmiany traktuje oba przypadki tak samo i przez
 * to potrafi pokazać poprawę tam, gdzie na ekranie nic się nie poprawiło —
 * dokładnie to zdarzyło się w M1.
 *
 * Wartości są oszacowaniem dla kroju monospace o normalnej grubości, nie wynikiem
 * pomiaru rasteryzacji. Do ważenia różnic to wystarcza: liczy się porządek między
 * glifami, nie druga cyfra po przecinku.
 *
 * To są dane materiałowe, więc mieszkają w `content`, a nie w kodzie testów.
 */
export const INK_COVERAGE: Readonly<Record<string, number>> = {
  ' ': 0,
  "'": 0.04,
  '.': 0.05,
  ',': 0.06,
  '`': 0.04,
  '-': 0.08,
  '"': 0.09,
  ':': 0.1,
  '|': 0.1,
  '^': 0.12,
  '~': 0.12,
  ';': 0.13,
  '/': 0.14,
  '\\': 0.14,
  '=': 0.16,
  '+': 0.18,
  'v': 0.18,
  '*': 0.22,
  'o': 0.24,
  'w': 0.3,
  'A': 0.34,
  'X': 0.36,
  'Z': 0.36,
  'O': 0.4,
  '%': 0.4,
  '$': 0.4,
  '0': 0.42,
  'H': 0.42,
  '#': 0.45,
  '&': 0.45,
  'M': 0.46,
  'B': 0.48,
  '8': 0.5,
  'W': 0.55,
  '@': 0.62,
};

/** Domyślne pokrycie dla glifu spoza tabeli — środek skali, żeby nie zaniżać wagi. */
export const INK_DEFAULT = 0.25;

/** Pokrycie dla kodu znaku; 0 dla pustej komórki bufora (kod 0). */
export function inkOf(charCode: number): number {
  if (charCode === 0) return 0;
  return INK_COVERAGE[String.fromCharCode(charCode)] ?? INK_DEFAULT;
}
