/**
 * Sprzężenie zwrotne walki: czasy i siły efektów, którymi gra odpowiada graczowi.
 *
 * Są w contencie, a nie w kodzie, z tego samego powodu co obrażenia: to są liczby
 * odczucia, strojone razem z czasami broni. Zamach maczugi trwa 460 ms, więc błysk
 * trafienia trwający 400 ms zlewałby się z następnym zdarzeniem i przestałby cokolwiek
 * znaczyć — te wartości mają sens wyłącznie względem siebie nawzajem.
 */
export const FEEDBACK = {
  /** ms: rozbłysk na sylwetce trafionego bytu */
  hitFlashMs: 130,
  /**
   * Ile podbić barwę bytu w błysku, 0..1 w stronę bieli. Nie podbijamy luminancji
   * powyżej jedynki, bo `shade` przycina do bieli i byt traci barwę zamiast błysnąć.
   */
  hitFlashMix: 0.75,
  /** ms: jak długo trzyma się klatka `Hit`, niezależnie od tego, co robi AI */
  hitHoldMs: 220,

  /** ms: przyciemnienie kadru po oberwaniu — krótkie, bo ma zakłuć, a nie oślepić */
  hurtDimMs: 140,
  /** mnożnik jasności kadru w szczycie efektu */
  hurtDim: 0.45,
  /** radiany: amplituda drgania kadru po oberwaniu */
  shakeAmp: 0.035,
  /** ms: jak długo drga */
  shakeMs: 180,
  /** Hz: częstotliwość drgania */
  shakeHz: 14,

  /** ms: jak długo świeci się wpis w linii zdarzeń, zanim zgaśnie */
  logFadeMs: 1200,
  /** ile wpisów naraz widać */
  logLines: 3,

  /** ms: rozbłysk na sylwetce przeciwnika, gdy MÓJ blok zatrzymał jego cios */
  blockFlashMs: 160,
} as const;
