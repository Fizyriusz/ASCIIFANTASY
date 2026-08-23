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
}
