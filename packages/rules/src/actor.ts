/**
 * Aktor: gracz i potwór są tym samym typem.
 *
 * Nie ma tu ECS-a ani systemu zdarzeń, bo nie ma czego rozwiązywać: dwieście bytów
 * w tablicy i `switch` po postawie wystarczą, a tyle nigdy nie jest widocznych naraz.
 *
 * Atrybuty i umiejętności są w jednej skali 0..100. Dzięki temu wzór trafienia
 * dodaje je wprost, bez przeliczników — a przelicznik między skalami to miejsce,
 * w którym balans przestaje być czytelny.
 */

import { COMBAT } from '@rpg/content';

/** SIŁ ZRĘ KON INT WOL CHA — kolejność jak w karcie postaci. */
export const Attr = {
  Str: 0,
  Agi: 1,
  Con: 2,
  Int: 3,
  Wil: 4,
  Cha: 5,
} as const;
export type Attr = (typeof Attr)[keyof typeof Attr];
export const ATTR_COUNT = 6;

export const Skill = {
  Blade: 0,
  Blunt: 1,
  Block: 2,
  Dodge: 3,
  Sneak: 4,
} as const;
export type Skill = (typeof Skill)[keyof typeof Skill];
export const SKILL_COUNT = 5;

/**
 * Postawa jest jednym polem, bo byt może robić tylko jedną rzecz naraz — i to
 * właśnie czyni walkę decyzją. Blok w trakcie zamachu albo unik w trakcie odbicia
 * są niemożliwe z definicji stanu, a nie dzięki sprawdzeniu, które da się przeoczyć.
 */
export const Stance = {
  Idle: 0,
  /** zamach w locie: cios jest już nie do cofnięcia */
  Windup: 1,
  /** po ciosie — najdroższy moment, tu się ginie */
  Recover: 2,
  Blocking: 3,
  Dodging: 4,
  Stagger: 5,
  Dead: 6,
} as const;
export type Stance = (typeof Stance)[keyof typeof Stance];

export interface Actor {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** 0..100, indeksowane `Attr` */
  attrs: Int8Array;
  /** 0..100, indeksowane `Skill` */
  skills: Uint8Array;
  /**
   * Ułamkowy postęp umiejętności. Osobno od `skills`, bo wzrost przez użycie daje
   * dziesiąte części punktu — bez akumulatora zaokrąglenie zjadałoby każdy przyrost
   * i umiejętność nie ruszyłaby się nigdy.
   */
  progress: Float32Array;
  /** indeks w `weapons` z contentu, `null` = pięści */
  weapon: number | null;
  /** indeks w `armors` z contentu, `null` = brak pancerza */
  armor: number | null;
  /** 0..100 zużycia; obniża obrażenia broni i ochronę pancerza liniowo */
  weaponWear: number;
  armorWear: number;
  /** kilogramy niesionego sprzętu, bez założonego */
  carriedKg: number;
  stance: Stance;
  /** ms: ile jeszcze trwa bieżąca postawa */
  stanceMs: number;
  /**
   * ms do wznowienia regeneracji wytrzymałości. Bez tego opóźnienia regeneracja
   * pokrywa większość kosztu ciosu w trakcie jego własnego cyklu i zasób przestaje
   * być zasobem: pomiar z M3 dawał 16–56 ciosów bez przerwy przy starciu trwającym
   * 4–5 s.
   */
  regenDelayMs: number;
  /**
   * Widocznie wyczerpany. Pole, a nie funkcja od `stamina`, bo próg ma histerezę:
   * wchodzi się poniżej `exhaustedBelow`, wychodzi powyżej `exhaustedClear`.
   * Pojedynczy próg dawałby migotanie stanu przy każdym tyknięciu regeneracji.
   */
  exhausted: boolean;
  /** ms: ile jeszcze trwa okno uniku — biegnie też w trakcie odbicia po uniku */
  dodgeMs: number;
}

/** Tworzy aktora z danych contentu. Poza gorącą ścieżką, więc czytelnie. */
export function makeActor(
  hp: number,
  stamina: number,
  attrs: readonly number[],
  skills: readonly number[],
): Actor {
  const a = new Int8Array(ATTR_COUNT);
  for (let i = 0; i < ATTR_COUNT; i++) a[i] = attrs[i] ?? 40;
  const s = new Uint8Array(SKILL_COUNT);
  for (let i = 0; i < SKILL_COUNT; i++) s[i] = skills[i] ?? 0;
  return {
    hp,
    maxHp: hp,
    stamina,
    maxStamina: stamina,
    attrs: a,
    skills: s,
    progress: new Float32Array(SKILL_COUNT),
    weapon: null,
    armor: null,
    weaponWear: 0,
    armorWear: 0,
    carriedKg: 0,
    stance: Stance.Idle,
    stanceMs: 0,
    regenDelayMs: 0,
    exhausted: false,
    dodgeMs: 0,
  };
}

export function isAlive(a: Actor): boolean {
  return a.stance !== Stance.Dead;
}

/**
 * Upływ czasu dla jednego bytu. Regeneruje wyłącznie wytrzymałość — hp nie wraca
 * samo z siebie nigdy. Regeneracja hp z czasem zamienia wytrzymałość w dekorację,
 * bo każde starcie da się wtedy przeczekać w kącie.
 */
export function tickActor(a: Actor, dtMs: number): void {
  if (a.stance === Stance.Dead) return;

  if (a.dodgeMs > 0) a.dodgeMs -= dtMs;

  if (a.stanceMs > 0) {
    a.stanceMs -= dtMs;
    if (a.stanceMs <= 0) {
      a.stanceMs = 0;
      // blok trzyma się sam, dopóki gracz go nie puści; reszta postaw wygasa
      if (a.stance !== Stance.Blocking) a.stance = Stance.Idle;
    }
  }

  if (a.regenDelayMs > 0) {
    a.regenDelayMs -= dtMs;
  } else {
    const perSec = a.stance === Stance.Blocking ? COMBAT.staminaRegenBlocking : COMBAT.staminaRegen;
    // przeciążony byt regeneruje wolniej — waga jest kosztem, a nie liczbą w panelu
    const regen = perSec * loadFactor(a) * (dtMs / 1000);
    a.stamina = Math.min(a.maxStamina, a.stamina + regen);
  }

  // histereza wyczerpania: dwa progi zamiast jednego, żeby stan nie migotał
  if (a.exhausted) {
    if (a.stamina > COMBAT.exhaustedClear) a.exhausted = false;
  } else if (a.stamina < COMBAT.exhaustedBelow) {
    a.exhausted = true;
  }
}

/**
 * Mnożnik regeneracji od obciążenia: 1 do połowy udźwigu, `COMBAT.overloadRegen`
 * przy pełnym i niżej już nie schodzi. Unieruchomienie gracza przez plecak jest
 * karą, która tylko frustruje — spowolnienie regeneracji wystarczy, żeby waga
 * była decyzją.
 */
export function loadFactor(a: Actor): number {
  const cap = Math.max(1, (a.attrs[Attr.Str] ?? 0) * COMBAT.carryPerStr);
  const t = a.carriedKg / cap;
  if (t <= 0.5) return 1;
  const over = Math.min(1, (t - 0.5) * 2);
  return 1 - over * (1 - COMBAT.overloadRegen);
}
