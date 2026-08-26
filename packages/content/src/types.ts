/**
 * Typy paczki settingu. Zero logiki — tu mieszkają wyłącznie dane.
 *
 * `content` leży **najniżej** w łańcuchu zależności z CLAUDE.md, więc nie importuje
 * niczego: ani `Material` z core, ani `Span` z world. Dlatego materiał opisujemy
 * stringami glifów, a nie gotowymi tablicami kodów znaków — kompilacja do postaci,
 * której chce renderer, należy do `core` (`compileMaterials`).
 *
 * Konsekwencja tego układu jest taka, że zmiana settingu nie może wymagać dotknięcia
 * kodu, i o to w tym podziale chodzi.
 */

/** Indeks materiału w skompilowanej tablicy paczki. Kolejność w paczce = kontrakt. */
export type MaterialIndex = number;

export interface MaterialDef {
  /** nazwa czytelna dla człowieka, wyłącznie do debugowania i map */
  id: string;
  /** glify od najgęstszego do najrzadszego, w trzech pasmach luminancji */
  bright: string;
  mid: string;
  dark: string;
  r: number;
  g: number;
  b: number;
  /** 0..1 — jak często hash schodzi z glifu podstawowego */
  roughness: number;
  /** 0..1 — ile powierzchnia świeci własnym światłem */
  emissive: number;
  /**
   * Czy przez materiał widać dalszą geometrię. Otwór drzwiowy i okno to spany
   * z materiałem przezroczystym: renderer ich nie maluje, ale **wie**, że kolumna
   * ma dziurę w środku, i przełącza się na maskę pokrycia. Bez tego sygnału
   * musiałby zgadywać z geometrii, a to się nie da odróżnić od zwykłej bryły
   * z niebem nad nią.
   *
   * **To jest pole wydajnościowe, nie wyglądowe.** Każda kolumna, która trafi
   * na taki span, kosztuje **1,8×** kolumny zwykłej (pomiar w §3.1 architektury):
   * maska nie umie zakończyć marszu, gdy fronty się zetkną. Ustawienie tej flagi
   * na materiale pospolitym — wodzie, listowiu, mgle — przenosi na wolną ścieżkę
   * całe sceny naraz i **nie psuje ani jednego snapshotu**, bo obraz wychodzi ten
   * sam, tylko wolniej. Dlatego lista materiałów przezroczystych jest wypisana
   * w każdej paczce, a `tools/harness/src/dungeon.test.ts` pilnuje, żeby sceny
   * zewnętrzne miały zero kolumn na ścieżce maski.
   */
  transparent?: boolean;
}

/**
 * Parametry światła settingu. Osobno od materiałów, bo opisują świat, a nie
 * powierzchnię: jak daleko świeci pochodnia i ile widać bez niej.
 */
export interface LightDef {
  /** metry: zasięg pochodni gracza */
  torchRadius: number;
  /** 0..1 — moc pochodni tuż przy źródle */
  torchPower: number;
  /**
   * 0..1 — **mnożnik światła dziennego** w dzień i w nocy.
   *
   * Mnożnik, a nie składnik: światło statyczne komórki mówi, ile *dnia* do niej
   * dociera, więc noc musi je wyzerować, a nie dodać do niego ciemność. Przy
   * wartości 1 wzór sprowadza się bajt w bajt do wersji sprzed M2.
   */
  daylightDay: number;
  daylightNight: number;
  /** metry: zasięg pojedynczego źródła statycznego (kaganek, żagiew w lochu) */
  sourceRadius: number;
  sourcePower: number;
}

/** Rodzaj rekwizytu. Decyduje o tym, ile spanów zajmuje i jak jest budowany. */
export type PropKind = 'tree' | 'bush' | 'rock';

export interface PropDef {
  id: string;
  kind: PropKind;
  /** materiał pnia / bryły */
  trunkMat: MaterialIndex;
  /** materiał korony; dla `rock` i `bush` równy `trunkMat` */
  crownMat: MaterialIndex;
  /** metry: zakres wysokości całości */
  minHeight: number;
  maxHeight: number;
  /** ułamek wysokości zajęty przez pień — reszta to korona */
  trunkFraction: number;
}

export interface BiomeDef {
  id: string;
  /** materiał czapki gruntu */
  ground: MaterialIndex;
  /** materiał ścian bocznych terenu (widoczny na uskokach i zboczach) */
  cliff: MaterialIndex;
  /** 0..1 — szansa, że komórka dostanie rekwizyt */
  propDensity: number;
  /** indeksy do `ContentPack.props`, losowane hashem pozycji */
  props: readonly number[];
  /** statyczne światło komórki 0..15 — las jest ciemniejszy niż łąka */
  light: number;
}

/**
 * Materiały konstrukcyjne podziemi i wnętrz. Osobny blok, bo nie należą do
 * żadnego biomu — loch wygląda tak samo pod łąką i pod borem.
 */
export interface UndergroundDef {
  /** lita skała: ściany komór i strop nad pustką */
  rock: MaterialIndex;
  /** gruz: podłoga komory */
  rubble: MaterialIndex;
  /** ściana i dach budowli naziemnej */
  wall: MaterialIndex;
  /** podłoga wnętrza */
  floor: MaterialIndex;
  /** otwór drzwiowy — materiał przezroczysty */
  doorway: MaterialIndex;
  /** okno — materiał przezroczysty */
  window: MaterialIndex;
  /** żagiew: źródło światła w lochu */
  torch: MaterialIndex;
}

export interface ContentPack {
  id: string;
  materials: readonly MaterialDef[];
  biomes: readonly BiomeDef[];
  props: readonly PropDef[];
  /**
   * Materiał lustra wody. Osobne pole, a nie własność biomu: woda w rzece i woda
   * w morzu to ta sama substancja, a biom opisuje brzeg, nie ciecz.
   */
  waterMaterial: MaterialIndex;
  /**
   * Materiał **nieba**: komórka, w którą nie trafiła żadna geometria.
   *
   * Niebo jest powierzchnią, nie brakiem powierzchni. Bez niego wylot jaskini
   * oglądany od środka jest czarnym prostokątem nie do odróżnienia od ściany —
   * w południe. Rampa robi robotę pory doby sama: pasmo jasne to dzień (glif
   * jednolity, zero szumu, więc niebo nie migocze przy obrocie), pasmo ciemne
   * ma w rampie spacje i wychodzą z tego rzadkie gwiazdy.
   */
  skyMaterial: MaterialIndex;
  light: LightDef;
  underground: UndergroundDef;
}
