/**
 * Deterministyczny hash całkowitoliczbowy — wspólne źródło szumu dla całego
 * projektu.
 *
 * Mieszka w `core`, bo `core` leży najniżej w łańcuchu zależności: renderer
 * potrzebuje go do doboru glifu z pozycji świata, a generacja świata do
 * wszystkiego. Dwie kopie tej funkcji rozjechałyby się przy pierwszej próbie
 * poprawienia rozrzutu i cicho zmieniły zarówno teksturę, jak i teren.
 *
 * `@rpg/world/rng` reeksportuje `h32` — w kodzie generacji świata nadal
 * importuje się go stamtąd, bo tam stoi reguła "żadnego Math.random()".
 */

/** Hash 4 liczb całkowitych → uint32. Podstawa całej generacji i tekstur. */
export function h32(a: number, b: number, c: number, d: number): number {
  let x =
    Math.imul(a | 0, 0x27d4eb2d) ^
    Math.imul(b | 0, 0x165667b1) ^
    Math.imul(c | 0, 0x9e3779b1) ^
    Math.imul(d | 0, 0x85ebca6b);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 16;
  return x >>> 0;
}
