/**
 * Marsz kolumnowy — serce renderera. DO ZAIMPLEMENTOWANIA W M0.
 *
 * Zastępuje parę "DDA + floor-casting" z prototypu jedną pętlą, która obsługuje
 * teren, budynki, mosty i wnętrza. Model: komórka to lista spanów (pionowych brył),
 * render w stylu voxel-space (Comanche) uogólnionym na wiele spanów.
 *
 * Szkic algorytmu (pełny opis: docs/architektura.md §3.1):
 *
 *   dla każdej kolumny ekranu:
 *     minRow = rows                      // najwyższy dotąd zamalowany wiersz
 *     DDA po siatce, krok po komórce:
 *       dla każdego spanu w komórce, od góry:
 *         rowTop = project(span.top, dist)
 *         rowBot = project(span.bottom, dist)
 *         jeśli rowTop >= minRow: pomiń        // zasłonięty przez bliższą geometrię
 *         maluj czapkę:  rowTop .. min(rowBot, minRow-1)   → capMat
 *         maluj ścianę:  poniżej czapki, jeśli widoczna    → mat
 *         minRow = rowTop
 *       jeśli minRow <= 0: przerwij kolumnę    // ekran zapełniony do góry
 *
 * Dlaczego near→far z `minRow` jest poprawne: bliższa geometria ma zawsze niższy
 * dolny wiersz, więc dalsza może być widoczna wyłącznie *powyżej* tego, co już
 * zamalowaliśmy. To pozwala odrzucić zasłonięte spany bez z-bufora.
 *
 * ZAKAZ ALOKACJI. Trafienia lądują w prealokowanych tablicach `ColumnHits`.
 */

export interface Camera {
  /** pozycja w komórkach siatki (nie w metrach) */
  x: number;
  y: number;
  /** wysokość oka nad podłożem, w metrach świata */
  eyeZ: number;
  yaw: number;
  pitch: number;
  fov: number;
}

/** Maks. liczba widocznych spanów na kolumnę. Powyżej i tak nic nie widać. */
export const MAX_HITS = 64;

/**
 * Prealokowany zestaw buforów na trafienia jednej kolumny.
 * Struktura tablic równoległych, nie tablica obiektów — 1200 obiektów na klatkę
 * to GC co sekundę, co widzieliśmy w prototypie.
 */
export interface ColumnHits {
  count: number;
  dist: Float64Array;
  topZ: Float64Array;
  bottomZ: Float64Array;
  rowTop: Float64Array;
  rowBot: Float64Array;
  /** ułamek pozycji trafienia wzdłuż ściany, 0..1 — do tekstury */
  wallU: Float64Array;
  /** 0 = ściana prostopadła do X, 1 = do Y. Do cieniowania boków. */
  side: Uint8Array;
  cellIndex: Int32Array;
  spanIndex: Int32Array;
}

export function createColumnHits(): ColumnHits {
  return {
    count: 0,
    dist: new Float64Array(MAX_HITS),
    topZ: new Float64Array(MAX_HITS),
    bottomZ: new Float64Array(MAX_HITS),
    rowTop: new Float64Array(MAX_HITS),
    rowBot: new Float64Array(MAX_HITS),
    wallU: new Float64Array(MAX_HITS),
    side: new Uint8Array(MAX_HITS),
    cellIndex: new Int32Array(MAX_HITS),
    spanIndex: new Int32Array(MAX_HITS),
  };
}

/** Co renderer musi umieć zapytać o świat. Celowo minimalne. */
export interface RenderTarget {
  /** liczba spanów w komórce */
  spanCount(cx: number, cy: number): number;
  /** górna krawędź spanu w metrach */
  spanTop(cx: number, cy: number, i: number): number;
  spanBottom(cx: number, cy: number, i: number): number;
  spanMaterial(cx: number, cy: number, i: number): number;
  spanCapMaterial(cx: number, cy: number, i: number): number;
  /** statyczne światło komórki 0..15 */
  light(cx: number, cy: number): number;
}
