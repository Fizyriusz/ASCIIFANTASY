/**
 * Paczka `wild` — dzikie pustkowie w duchu high fantasy. Aktywny setting gry.
 *
 * Zasada doboru palety: w ASCII czytelność bierze się z **glifu**, nie z koloru.
 * Trawa i mech mają te same odcienie zieleni w granicach kilkunastu punktów, ale
 * zupełnie inne rampy znaków — i to jest jedyny powód, dla którego da się je
 * odróżnić na ekranie. Kolory są ziemiste i przygaszone; neon z M0 wyglądałby tu
 * jak awaria monitora.
 */

import type {
  BiomeDef,
  ContentPack,
  LightDef,
  MaterialDef,
  PropDef,
  UndergroundDef,
} from '../../types.js';

export const WildMat = {
  Dirt: 0,
  Grass: 1,
  Moss: 2,
  Stone: 3,
  Rock: 4,
  Sand: 5,
  Gravel: 6,
  Water: 7,
  Bark: 8,
  Leaves: 9,
  Conifer: 10,
  Deadwood: 11,
  Snow: 12,
  /* --- M2: podziemia i wnętrza --- */
  Granite: 13,
  Rubble: 14,
  Planks: 15,
  /** otwór drzwiowy: przezroczysty, przechodni */
  Doorway: 16,
  /** okno: przezroczyste, nieprzechodnie — różnica jest w kolizji, nie w renderze */
  Window: 17,
  /** żagiew: świeci własnym światłem i jest źródłem dla oświetlenia dynamicznego */
  Torch: 18,
} as const;

export type WildMat = (typeof WildMat)[keyof typeof WildMat];

/**
 * Dobór glifów w rampie: wariacja ma iść w **kształt**, nie w **ciężar**.
 * Tabela `INK_COVERAGE` mówi, ile atramentu zajmuje glif; rampa mchu `&%@` miała
 * rozrzut 0,40–0,62, więc każda zamiana `&` na `@` była skokiem wagi o 0,17
 * i czytała się jako mruganie, a nie jako faktura. Rampy poniżej trzymają
 * rozrzut poniżej ~0,1 przy zachowanych trzech różnych kształtach.
 *
 * `roughness` opisuje **materiał**, a nie strategię tłumienia migotania: kora jest
 * szorstka, woda gładka, kamień pośrodku. W M1 wartości te zbito do 0,15–0,2, żeby
 * uciszyć aliasing dalekiego gruntu — to działało, ale kosztem faktury z bliska.
 * Po M1c aliasingiem zajmuje się renderer (krok hasha i wygaszanie `roughness`
 * rosnące z rzutowanym rozmiarem komórki), więc dane wracają do opisu materiału.
 */
const materials: readonly MaterialDef[] = [
  { id: 'dirt', bright: '%&#', mid: '=~-', dark: ':.', r: 118, g: 94, b: 68, roughness: 0.5, emissive: 0 },
  { id: 'grass', bright: '"v*', mid: ',v:', dark: '.', r: 96, g: 132, b: 68, roughness: 0.6, emissive: 0 },
  { id: 'moss', bright: '&%#', mid: '*o+', dark: ':.', r: 78, g: 112, b: 74, roughness: 0.6, emissive: 0 },
  { id: 'stone', bright: '#%&', mid: '=+*', dark: ':.', r: 138, g: 138, b: 146, roughness: 0.55, emissive: 0 },
  { id: 'rock', bright: '#8%', mid: '#=+', dark: '*:', r: 112, g: 108, b: 104, roughness: 0.5, emissive: 0 },
  { id: 'sand', bright: '::.', mid: '.,', dark: '.', r: 198, g: 178, b: 130, roughness: 0.35, emissive: 0 },
  { id: 'gravel', bright: 'oo:', mid: ':,.', dark: '.', r: 150, g: 142, b: 128, roughness: 0.55, emissive: 0 },
  // Woda jest tu jedynym materiałem trzymanym celowo gładko i z rampą złożoną
  // z '~' i '-': lustro czyta się w ASCII wyłącznie wtedy, gdy tworzy długie
  // poziome serie. To decyzja o czytelności, nie obejście migotania.
  { id: 'water', bright: '~~-', mid: '~--', dark: '--', r: 82, g: 138, b: 196, roughness: 0.15, emissive: 0.05 },
  { id: 'bark', bright: 'HB#', mid: '||=', dark: ':.', r: 104, g: 76, b: 52, roughness: 0.7, emissive: 0 },
  { id: 'leaves', bright: '&%#', mid: '*o+', dark: ':.', r: 84, g: 124, b: 62, roughness: 0.7, emissive: 0 },
  { id: 'conifer', bright: '^*+', mid: '^*+', dark: ':.', r: 56, g: 92, b: 66, roughness: 0.7, emissive: 0 },
  { id: 'deadwood', bright: '=-|', mid: '-:.', dark: '.', r: 122, g: 106, b: 84, roughness: 0.65, emissive: 0 },
  { id: 'snow', bright: '@8O', mid: '*o+', dark: ':.', r: 226, g: 232, b: 240, roughness: 0.3, emissive: 0 },
  // Podziemia: granit jest gładszy od skały powierzchniowej, gruz drobniejszy.
  { id: 'granite', bright: '#%&', mid: '=+*', dark: ':.', r: 104, g: 100, b: 108, roughness: 0.45, emissive: 0 },
  { id: 'rubble', bright: 'oo%', mid: ':,+', dark: '..', r: 118, g: 112, b: 104, roughness: 0.6, emissive: 0 },
  { id: 'planks', bright: '==#', mid: '--=', dark: '..', r: 132, g: 104, b: 66, roughness: 0.4, emissive: 0 },
  // --- MATERIAŁY PRZEZROCZYSTE PACZKI: doorway, window. Tylko te dwa. ---
  //
  // Renderer ich nie maluje — rampy są tu wyłącznie po to, żeby tablica materiałów
  // miała spójny kształt, i nigdy nie trafiają na ekran. Każdy wpis na tej liście
  // to **koszt renderowania, nie wygląd**: kolumna, która trafi na span takiego
  // materiału, przechodzi na maskę pokrycia i kosztuje 1,8× kolumny zwykłej.
  // Dopisanie tu wody albo listowia spowolniłoby każdą scenę z rzeką lub lasem
  // i nie ruszyłoby żadnego snapshotu, bo obraz byłby identyczny. Zanim dopiszesz
  // trzeci materiał, sprawdź, czy naprawdę ma być przez niego widać **geometrię
  // za nim** — półprzezroczystość wizualna to `emissive` i kolor, nie ta flaga.
  { id: 'doorway', bright: ' ', mid: ' ', dark: ' ', r: 0, g: 0, b: 0, roughness: 0, emissive: 0, transparent: true },
  { id: 'window', bright: ' ', mid: ' ', dark: ' ', r: 0, g: 0, b: 0, roughness: 0, emissive: 0, transparent: true },
  { id: 'torch', bright: '*@', mid: '+o', dark: '.', r: 255, g: 208, b: 130, roughness: 0.3, emissive: 1 },
];

/**
 * Światło settingu. `daylightNight` jest **zerem** i to nie jest przeoczenie:
 * ciemność ma być przeszkodą, a nie efektem. Dodanie tu 0,05 „dla wygody"
 * kasuje całą mechanikę eksploracji podziemi.
 */
const light: LightDef = {
  torchRadius: 8,
  torchPower: 0.95,
  daylightDay: 1,
  daylightNight: 0,
  sourceRadius: 7,
  sourcePower: 0.85,
};

export const WildProp = {
  Oak: 0,
  Pine: 1,
  DeadTree: 2,
  Bush: 3,
  Boulder: 4,
} as const;

const props: readonly PropDef[] = [
  {
    id: 'oak',
    kind: 'tree',
    trunkMat: WildMat.Bark,
    crownMat: WildMat.Leaves,
    minHeight: 6,
    maxHeight: 11,
    trunkFraction: 0.42,
  },
  {
    id: 'pine',
    kind: 'tree',
    trunkMat: WildMat.Bark,
    crownMat: WildMat.Conifer,
    minHeight: 8,
    maxHeight: 15,
    trunkFraction: 0.3,
  },
  {
    id: 'dead-tree',
    kind: 'tree',
    trunkMat: WildMat.Deadwood,
    crownMat: WildMat.Deadwood,
    minHeight: 4,
    maxHeight: 7,
    trunkFraction: 0.7,
  },
  {
    id: 'bush',
    kind: 'bush',
    trunkMat: WildMat.Leaves,
    crownMat: WildMat.Leaves,
    minHeight: 0.8,
    maxHeight: 1.8,
    trunkFraction: 1,
  },
  {
    id: 'boulder',
    kind: 'rock',
    trunkMat: WildMat.Rock,
    crownMat: WildMat.Rock,
    minHeight: 0.9,
    maxHeight: 2.6,
    trunkFraction: 1,
  },
];

/** Kolejność = BiomeId. Świat trzyma sam indeks, nazwa jest do debugowania. */
export const WildBiome = {
  Meadow: 0,
  Broadleaf: 1,
  Conifer: 2,
  Heath: 3,
  Marsh: 4,
  RockyRidge: 5,
  Riverbank: 6,
  Beach: 7,
} as const;

export type WildBiome = (typeof WildBiome)[keyof typeof WildBiome];

const biomes: readonly BiomeDef[] = [
  {
    id: 'meadow',
    ground: WildMat.Grass,
    cliff: WildMat.Dirt,
    propDensity: 0.035,
    props: [WildProp.Bush, WildProp.Oak],
    light: 15,
  },
  {
    id: 'broadleaf',
    ground: WildMat.Moss,
    cliff: WildMat.Dirt,
    propDensity: 0.14,
    props: [WildProp.Oak, WildProp.Oak, WildProp.Bush, WildProp.DeadTree],
    light: 10,
  },
  {
    id: 'conifer',
    ground: WildMat.Moss,
    cliff: WildMat.Stone,
    propDensity: 0.16,
    props: [WildProp.Pine, WildProp.Pine, WildProp.DeadTree],
    light: 9,
  },
  {
    id: 'heath',
    ground: WildMat.Dirt,
    cliff: WildMat.Gravel,
    propDensity: 0.08,
    props: [WildProp.Bush, WildProp.Boulder],
    light: 15,
  },
  {
    id: 'marsh',
    ground: WildMat.Moss,
    cliff: WildMat.Dirt,
    propDensity: 0.12,
    props: [WildProp.DeadTree, WildProp.Bush],
    light: 13,
  },
  {
    id: 'rocky-ridge',
    ground: WildMat.Rock,
    cliff: WildMat.Stone,
    propDensity: 0.05,
    props: [WildProp.Boulder],
    light: 15,
  },
  {
    id: 'riverbank',
    ground: WildMat.Gravel,
    cliff: WildMat.Dirt,
    propDensity: 0.1,
    props: [WildProp.Bush, WildProp.Oak],
    light: 14,
  },
  {
    id: 'beach',
    ground: WildMat.Sand,
    cliff: WildMat.Sand,
    propDensity: 0.02,
    props: [WildProp.Boulder],
    light: 15,
  },
];

const underground: UndergroundDef = {
  rock: WildMat.Granite,
  rubble: WildMat.Rubble,
  wall: WildMat.Planks,
  floor: WildMat.Planks,
  doorway: WildMat.Doorway,
  window: WildMat.Window,
  torch: WildMat.Torch,
};

export const wildPack: ContentPack = {
  id: 'wild',
  materials,
  biomes,
  props,
  waterMaterial: WildMat.Water,
  light,
  underground,
};
