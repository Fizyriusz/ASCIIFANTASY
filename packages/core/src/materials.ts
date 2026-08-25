/**
 * Materiały zamiast tekstur.
 *
 * W rendererze znakowym nie ma bitmap — o wyglądzie powierzchni decyduje para
 * (rampa glifów, kolor bazowy), a "detal" powstaje z hasha pozycji świata.
 * Dzięki temu ściana ma strukturę, a nie jednolitą plamę, i nie kosztuje to
 * ani jednego bajtu pamięci tekstur.
 *
 * Hash liczymy z **współrzędnych świata**, nigdy ekranu. To nie jest detal
 * estetyczny: przy hashu z pozycji na ekranie tekstura płynie po fasadzie przy
 * każdym kroku gracza i wygląda jak błąd renderowania, którym jest.
 *
 * ## Stabilność przy ruchu — dlaczego krok hasha zależy od odległości
 *
 * Hash po współrzędnych świata usuwa pływanie, ale nie usuwa **aliasingu**.
 * Jedna komórka ekranu pokrywa tym większy kawałek świata, im dalej patrzy:
 * przy 50 m to dziesiątki metrów terenu. Punkt próbkowania przeskakuje wtedy
 * przy ruchu przez wiele kratek hasha i glif losuje się od nowa co klatkę —
 * pod horyzontem powstaje pas migotania.
 *
 * W M1 tłumiono to obniżeniem `roughness` w danych. To nie była naprawa
 * próbkowania: `roughness` steruje tym, *jak mocno* hash wpływa na wybór glifu,
 * więc jego wyzerowanie usuwa sygnał, który się aliasował, a nie aliasing.
 * Daleka trawa była spokojna, ponieważ była jednorodna — i ta sama zmiana
 * odebrałaby fakturę ścianie lochu stojącej metr od oka.
 *
 * Właściwe rozwiązanie to jedyny odpowiednik mipmapy dostępny w siatce znaków:
 * **krok kratki hasha rośnie z rzutowanym rozmiarem komórki**, a `roughness`
 * gaśnie, gdy komórka pokrywa już tyle świata, że faktura i tak jest nieczytelna.
 * Krok skacze po potęgach dwójki, bo krok zmieniany płynnie sprawia, że tekstura
 * „oddycha" przy każdym kroku gracza — rzadkie, twarde przejścia są mniej widoczne
 * niż ciągłe pełzanie.
 */

import type { MaterialDef } from '@rpg/content';
import { h32 } from './hash.js';

export interface Material {
  glyphsBright: readonly number[];
  glyphsMid: readonly number[];
  glyphsDark: readonly number[];
  r: number;
  g: number;
  b: number;
  /** 0..1 — jak często hash wybiera glif inny niż podstawowy dla danego pasma */
  roughness: number;
  /** 0..1 — ile powierzchnia świeci własnym światłem, niezależnie od oświetlenia */
  emissive: number;
  /** czy przez materiał widać dalszą geometrię — otwór drzwiowy, okno */
  transparent: boolean;
  /**
   * Najniższa luminancja, przy której materiał w ogóle **widać**.
   *
   * Blit kwantyzuje kolor do 15 bitów przez `pack15`, czyli obcina trzy młodsze
   * bity każdego kanału. Kamień o barwie 112 przy luminancji 0,04 daje kanał 5,
   * a `5 >> 3` to zero: renderer maluje wtedy glif **czarny na czarnym**. Z punktu
   * widzenia gracza to nie jest ciemna ściana, tylko brak ściany — a w lochu ta
   * różnica decyduje o tym, czy da się nawigować.
   *
   * Próg wychodzi z kwantyzacji, nie z gustu: `8 / najjaśniejszy kanał` to dokładnie
   * ta luminancja, przy której kolor przestaje się zerować. Materiał ciemny gaśnie
   * wcześniej niż jasny i tak ma być.
   */
  minLum: number;
}

/**
 * Strojenie faktury, zamrożone. W trakcie M1c był to obiekt mutowalny, żeby dało
 * się przemiatać wartości pomiarem; przemiatanie się skończyło, więc `as const`
 * — nikt nie ma tego zmieniać w czasie działania gry, a silnik może te liczby
 * traktować jak stałe.
 */
export const TEXTURE_TUNING = {
  /**
   * Metry: najdrobniejsza kratka hasha. Poniżej tego nie schodzimy, bo komórka
   * świata ma 2 m i drobniejsza faktura nie ma się na czym oprzeć.
   */
  baseStep: 0.5,
  /**
   * Ile kratek hasha ma przypadać na komórkę ekranu. Jedynka to granica Nyquista
   * i widać ją jako migotanie pierwszego planu. Trójka wybrana pomiarem: przy niej
   * metryka ważona jest lepsza od stanu z M1 na wszystkich pięciu scenach mimo
   * `roughness` podniesionego z 0,15–0,2 do 0,5–0,7. Wyżej zyski są w granicach
   * szumu, a faktura zbija się w kępy zamiast ziarna.
   */
  detail: 3,
  /** metry: rzutowana komórka, przy której faktura jest jeszcze w pełni czytelna */
  footFull: 0.6,
  /** metry: rzutowana komórka, przy której zostaje sam glif podstawowy */
  footFlat: 2.4,
} as const;

function codes(s: string): readonly number[] {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Luminancja, poniżej której `pack15` zeruje wszystkie trzy kanały tego koloru.
 * Materiał czarny (otwór drzwiowy) dostaje nieskończoność i nie maluje się nigdy.
 */
function minVisibleLum(r: number, g: number, b: number): number {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  return max <= 0 ? Number.POSITIVE_INFINITY : 8 / max;
}

/**
 * Zamienia definicje z paczki settingu na tablicę materiałów renderera.
 * Wołane raz przy starcie sceny — indeks w wyniku odpowiada indeksowi w paczce,
 * bo to właśnie ten indeks świat zapisuje w spanie.
 */
export function compileMaterials(defs: readonly MaterialDef[]): Material[] {
  const out = new Array<Material>(defs.length);
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (d === undefined) continue;
    out[i] = {
      glyphsBright: codes(d.bright),
      glyphsMid: codes(d.mid),
      glyphsDark: codes(d.dark),
      r: d.r,
      g: d.g,
      b: d.b,
      roughness: d.roughness,
      emissive: d.emissive,
      transparent: d.transparent === true,
      minLum: minVisibleLum(d.r, d.g, d.b),
    };
  }
  return out;
}

/**
 * Krok kratki hasha dla danego rzutowanego rozmiaru komórki, zaokrąglony w górę
 * do potęgi dwójki wielokrotności `BASE_STEP`. Pętla wykonuje się kilka razy —
 * taniej niż `Math.log2` w hot pathcie i bez ryzyka błędu zaokrąglenia.
 */
export function hashStep(footprint: number): number {
  const target = footprint * TEXTURE_TUNING.detail;
  let step = TEXTURE_TUNING.baseStep;
  while (step < target) step *= 2;
  return step;
}

/**
 * Ile z `roughness` materiału zostaje przy danym rzutowanym rozmiarze komórki.
 * Blisko pełna wartość z paczki, daleko zero — czyli jeden glif podstawowy.
 */
export function roughnessFalloff(footprint: number): number {
  const full = TEXTURE_TUNING.footFull;
  const flat = TEXTURE_TUNING.footFlat;
  if (footprint <= full) return 1;
  if (footprint >= flat) return 0;
  const t = (footprint - full) / (flat - full);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Luminancja → pasmo → hash pozycji świata → konkretny glif.
 *
 * `wx`, `wy`, `wz` są w **metrach świata**, `footprint` to rzutowany rozmiar
 * komórki znakowej w metrach w miejscu trafienia. Kwantyzacja dzieje się tutaj,
 * a nie u wołającego, bo krok zależy od `footprint` i musi być spójny dla
 * wszystkich trzech osi.
 */
export function materialGlyph(
  m: Material,
  lum: number,
  wx: number,
  wy: number,
  wz: number,
  footprint: number,
): number {
  const ramp = lum >= 0.62 ? m.glyphsBright : lum >= 0.26 ? m.glyphsMid : m.glyphsDark;
  const len = ramp.length;
  if (len === 0) return 32;
  const rough = m.roughness * roughnessFalloff(footprint);
  if (rough <= 0) return ramp[0] ?? 32;
  const step = hashStep(footprint);
  const inv = 1 / step;
  const h = h32(
    Math.floor(wx * inv),
    Math.floor(wy * inv),
    Math.floor(wz * inv),
    0,
  );
  // dolne 16 bitów decyduje "czy szum", górne "który glif" — jeden hash, dwa użycia
  const noise = (h & 0xffff) * 0.0000152587890625;
  const idx = noise < rough ? (h >>> 16) % len : 0;
  return ramp[idx] ?? 32;
}
