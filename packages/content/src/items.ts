/**
 * Przedmioty jako dane. Kod reguł nie zna ani jednej z tych liczb — dostaje
 * definicję po indeksie i liczy z niej obrażenia, wagę i czasy.
 *
 * Czasy zamachu są **w milisekundach realnego czasu**, bo walka w M3 jest
 * real-time: różnica między sztyletem a maczugą to nie tabela obrażeń, tylko
 * to, jak długo jesteś bezbronny po ciosie.
 */

/** Umiejętność, w której rośnie doświadczenie z użycia tej broni. */
export const WeaponSkill = {
  Blade: 0,
  Blunt: 1,
} as const;
export type WeaponSkill = (typeof WeaponSkill)[keyof typeof WeaponSkill];

export interface WeaponDef {
  id: string;
  name: string;
  /** obrażenia bazowe przed siłą i pancerzem */
  dmgMin: number;
  dmgMax: number;
  /** ms: od naciśnięcia do trafienia — w tym czasie już nie da się cofnąć ciosu */
  windupMs: number;
  /** ms: po trafieniu, zanim można zrobić cokolwiek innego */
  recoverMs: number;
  /** wytrzymałość zużyta na jeden zamach */
  stamina: number;
  /** metry: zasięg ciosu liczony od środka do środka bytu */
  reachM: number;
  weightKg: number;
  skill: WeaponSkill;
  /** ile punktów zużycia (0..100) dodaje jedno trafienie */
  wearPerHit: number;
}

export interface ArmorDef {
  id: string;
  name: string;
  /** płaska redukcja obrażeń przy pełnym stanie; zużycie ją obniża liniowo */
  protection: number;
  weightKg: number;
  /** ile punktów zużycia dodaje jedno przyjęte trafienie */
  wearPerHit: number;
}

/**
 * Trzy bronie wystarczą, żeby wybór między nimi był decyzją: sztylet bije szybko
 * i tanio, ale nie przebija pancerza; maczuga bije mocno, ale po pudle stoisz
 * pół sekundy. Miecz jest środkiem i dlatego jest nudny — i o to chodzi.
 */
export const weapons: readonly WeaponDef[] = [
  {
    id: 'dagger',
    name: 'sztylet',
    dmgMin: 2,
    dmgMax: 5,
    windupMs: 180,
    recoverMs: 200,
    stamina: 7,
    reachM: 1.2,
    weightKg: 0.6,
    skill: WeaponSkill.Blade,
    wearPerHit: 0.4,
  },
  {
    id: 'shortsword',
    name: 'krótki miecz',
    dmgMin: 4,
    dmgMax: 9,
    windupMs: 320,
    recoverMs: 340,
    stamina: 13,
    reachM: 1.6,
    weightKg: 1.4,
    skill: WeaponSkill.Blade,
    wearPerHit: 0.3,
  },
  {
    id: 'club',
    name: 'maczuga',
    dmgMin: 3,
    dmgMax: 13,
    windupMs: 460,
    recoverMs: 520,
    stamina: 19,
    reachM: 1.5,
    weightKg: 2.6,
    skill: WeaponSkill.Blunt,
    wearPerHit: 0.2,
  },
];

export const Weapon = {
  Dagger: 0,
  Shortsword: 1,
  Club: 2,
} as const;
export type Weapon = (typeof Weapon)[keyof typeof Weapon];

export const armors: readonly ArmorDef[] = [
  { id: 'rags', name: 'łachmany', protection: 0, weightKg: 1, wearPerHit: 0 },
  { id: 'leather', name: 'skórznia', protection: 2, weightKg: 6, wearPerHit: 0.5 },
  { id: 'mail', name: 'kolczuga', protection: 4, weightKg: 13, wearPerHit: 0.35 },
];

export const Armor = {
  Rags: 0,
  Leather: 1,
  Mail: 2,
} as const;
export type Armor = (typeof Armor)[keyof typeof Armor];
