/**
 * Paczka `neon` — cyberpunkowe miasto z M0, odłożone na bok.
 *
 * Nie jest podpięta do gry. Trzymamy ją, bo jest testem regresji na tezę
 * „setting to dane": jeśli po trzech milestone'ach nadal buduje się i renderuje
 * bez dotykania rdzenia, to znaczy, że rozdział silnik/setting faktycznie istnieje.
 *
 * Wartości materiałów są **identyczne** z tablicą z M0 — złote pliki `ref-street`,
 * `ref-turned`, `ref-pitch-up`, `bridge` i `interior` zależą od nich co do bajta.
 */

import type { ContentPack, LightDef, MaterialDef, UndergroundDef } from '../../types.js';

/** Indeksy materiałów paczki. Kolejność jest kontraktem — świat zapisuje ją w spanie. */
export const NeonMat = {
  Stone: 0,
  Plaster: 1,
  Glass: 2,
  Asphalt: 3,
  Pavement: 4,
  Grass: 5,
  Water: 6,
  Wood: 7,
  Metal: 8,
  Lamp: 9,
} as const;

export type NeonMat = (typeof NeonMat)[keyof typeof NeonMat];

// Materiały przezroczyste tej paczki: **żadne**. Miasto z M0 nie ma otworów,
// więc każda jego kolumna idzie szybką ścieżką dwóch frontów (patrz `transparent`
// w `types.ts` — to pole kosztuje 1,8× czasu kolumny).
const materials: readonly MaterialDef[] = [
  { id: 'stone', bright: '#%&', mid: '=+*', dark: ':.', r: 150, g: 150, b: 160, roughness: 0.75, emissive: 0 },
  { id: 'plaster', bright: '8OB', mid: 'o=-', dark: '.,', r: 205, g: 195, b: 170, roughness: 0.55, emissive: 0 },
  { id: 'glass', bright: '#=|', mid: '|:-', dark: '.', r: 120, g: 190, b: 220, roughness: 0.35, emissive: 0.15 },
  { id: 'asphalt', bright: '=-', mid: '-:', dark: '.', r: 74, g: 74, b: 82, roughness: 0.6, emissive: 0 },
  { id: 'pavement', bright: '##=', mid: '::-', dark: '.', r: 124, g: 124, b: 132, roughness: 0.5, emissive: 0 },
  { id: 'grass', bright: '"w%', mid: ',v:', dark: '.', r: 74, g: 148, b: 74, roughness: 0.9, emissive: 0 },
  { id: 'water', bright: '~-', mid: '~:', dark: '.', r: 60, g: 120, b: 200, roughness: 0.8, emissive: 0.05 },
  { id: 'wood', bright: 'HB#', mid: '=+-', dark: ':.', r: 142, g: 96, b: 56, roughness: 0.65, emissive: 0 },
  { id: 'metal', bright: 'M8#', mid: '#=-', dark: ':.', r: 170, g: 175, b: 185, roughness: 0.45, emissive: 0 },
  { id: 'lamp', bright: '*@', mid: '+o', dark: '.', r: 255, g: 220, b: 140, roughness: 0.3, emissive: 1 },
];

/**
 * Miasto nie ma biomów ani rekwizytów — jego układ powstaje w generatorze
 * (`@rpg/world/packs/neon`), a nie z tabel. To celowa asymetria względem `wild`:
 * paczka opisuje setting, a nie sposób jego wytworzenia.
 */
/** Miasto z M0 świeci własnymi neonami — pochodnia i noc go nie dotyczą. */
const light: LightDef = {
  torchRadius: 8,
  torchPower: 0,
  daylightDay: 1,
  daylightNight: 1,
  sourceRadius: 7,
  sourcePower: 0,
};

/**
 * Miasto z M0 nie ma podziemi ani wnętrz — te indeksy istnieją wyłącznie po to,
 * żeby paczka miała pełny kształt. Gdyby kiedyś powstał neonowy loch, to jest
 * miejsce, w którym dostanie własne materiały.
 */
const underground: UndergroundDef = {
  rock: NeonMat.Stone,
  rubble: NeonMat.Pavement,
  wall: NeonMat.Plaster,
  floor: NeonMat.Pavement,
  doorway: NeonMat.Stone,
  window: NeonMat.Glass,
  torch: NeonMat.Lamp,
};

export const neonPack: ContentPack = {
  id: 'neon',
  materials,
  biomes: [],
  props: [],
  waterMaterial: NeonMat.Water,
  light,
  underground,
};
