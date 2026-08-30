/**
 * Walka w czasie rzeczywistym.
 *
 * Cios nie jest zdarzeniem, tylko odcinkiem czasu: `Windup` (zamach, którego nie
 * da się już cofnąć) → trafienie → `Recover` (bezradność). Dlatego wybór broni jest
 * decyzją: maczuga bije dwa razy mocniej od sztyletu, ale zostawia cię otwartego
 * na pół sekundy, a w tym czasie goblin zdąży uderzyć dwa razy.
 *
 * Wytrzymałość jest zasobem, który tę decyzję wymusza. Bez niej zostaje klikanie:
 * optymalną strategią byłoby atakowanie bez przerwy, bo nic nie kosztuje.
 *
 * Rzut jest jeden — `baza + umiejętność + zręczność − obrona`. Bez tabel, bez rzutów
 * przeciwstawnych, bez stopni sukcesu: każdy z nich to kolejny plik do strojenia,
 * a nie kolejna decyzja dla gracza.
 *
 * Funkcje nie alokują: wynik trafienia zapisuje się do obiektu podanego przez
 * wywołującego, bo `resolveAttack` biegnie w pętli gry razem z renderem.
 */

import { COMBAT, WeaponSkill } from '@rpg/content';
import type { WeaponDef } from '@rpg/content';
import { Attr, Skill, Stance, tickActor } from './actor.js';
import type { Actor } from './actor.js';
import { protectionOf, weaponOf, weaponWearFactor, armorOf } from './equipment.js';
import { train } from './progress.js';

/** Wynik jednego ciosu. Jeden obiekt na pętlę gry, nie jeden na trafienie. */
export interface AttackResult {
  /** czy cios doszedł do ciała (blok liczy się jako dojście) */
  landed: boolean;
  blocked: boolean;
  dodged: boolean;
  /** obrażenia po bloku i pancerzu */
  damage: number;
  killed: boolean;
  /** czy obrońca stracił równowagę */
  staggered: boolean;
}

export function makeAttackResult(): AttackResult {
  return { landed: false, blocked: false, dodged: false, damage: 0, killed: false, staggered: false };
}

/**
 * Umiejętność, w której rośnie doświadczenie z tej broni. Content zna tylko podział
 * ostrze/obuch, a karta postaci ma pięć umiejętności — mapowanie jest tutaj, żeby
 * dodanie łucznictwa nie wymagało zmiany contentu w dwóch miejscach naraz.
 */
function skillOf(w: WeaponDef): Skill {
  return w.skill === WeaponSkill.Blade ? Skill.Blade : Skill.Blunt;
}

/** Czy byt może w tej chwili zacząć cokolwiek robić. */
function ready(a: Actor): boolean {
  return a.stance === Stance.Idle || a.stance === Stance.Blocking;
}

/**
 * Zaczyna zamach. Zwraca `false`, gdy byt jest w trakcie czegoś innego albo nie ma
 * wytrzymałości — i to jest cała kara za spamowanie ataku: brak ciosu, nie komunikat.
 */
export function beginAttack(a: Actor): boolean {
  if (!ready(a)) return false;
  const w = weaponOf(a);
  if (a.stamina < w.stamina) return false;
  a.stamina -= w.stamina;
  a.stance = Stance.Windup;
  a.stanceMs = w.windupMs;
  return true;
}

export function beginBlock(a: Actor): boolean {
  if (a.stance !== Stance.Idle) return false;
  a.stance = Stance.Blocking;
  a.stanceMs = 0;
  return true;
}

export function endBlock(a: Actor): void {
  if (a.stance === Stance.Blocking) {
    a.stance = Stance.Idle;
    a.stanceMs = 0;
  }
}

/**
 * Unik: krótkie okno, w którym obrona rośnie, i dłuższe odbicie, w którym nic nie
 * można zrobić. Okno jest krótsze od odbicia, więc unik w ciemno jest gorszy niż
 * unik w odpowiedzi na zamach — na tym polega timing.
 */
export function beginDodge(a: Actor): boolean {
  if (!ready(a)) return false;
  if (a.stamina < COMBAT.dodgeStamina) return false;
  a.stamina -= COMBAT.dodgeStamina;
  a.stance = Stance.Dodging;
  a.stanceMs = COMBAT.dodgeRecoverMs;
  a.dodgeMs = COMBAT.dodgeWindowMs;
  return true;
}

/**
 * Upływ czasu w walce. Zwraca `true` dokładnie w tej klatce, w której zamach
 * dochodzi do celu — wtedy wywołujący sprawdza zasięg i woła `resolveAttack`.
 * Postawa przechodzi wtedy od razu w `Recover`, więc cios „w powietrze" kosztuje
 * tyle samo co trafiony.
 */
export function stepCombat(a: Actor, dtMs: number): boolean {
  const connects = a.stance === Stance.Windup && a.stanceMs - dtMs <= 0;
  tickActor(a, dtMs);
  if (connects) {
    a.stance = Stance.Recover;
    a.stanceMs = weaponOf(a).recoverMs;
    return true;
  }
  return false;
}

/** Szansa trafienia po wszystkich modyfikatorach. Wystawiona, bo używa jej AI. */
export function hitChance(att: Actor, def: Actor): number {
  const w = weaponOf(att);
  const skill = att.skills[skillOf(w)] ?? 0;
  const agi = att.attrs[Attr.Agi] ?? 0;
  let p = COMBAT.baseHit + skill * COMBAT.hitPerSkill + agi * COMBAT.hitPerAgi - defenseOf(def);
  if (p < COMBAT.hitMin) p = COMBAT.hitMin;
  if (p > COMBAT.hitMax) p = COMBAT.hitMax;
  return p;
}

/** Obrona: bierna, plus umiejętność uniku, plus premia za unik trafiony w oknie. */
export function defenseOf(def: Actor): number {
  if (def.stance === Stance.Dead || def.stance === Stance.Stagger) return 0;
  let d = COMBAT.defBase + (def.skills[Skill.Dodge] ?? 0) * COMBAT.defPerDodgeSkill;
  if (def.dodgeMs > 0) d += COMBAT.defDodgeWindow;
  return d;
}

/**
 * Rozstrzyga jeden cios. `rng` to funkcja 0..1 podana z zewnątrz — reguły nie znają
 * generatora, dzięki czemu test może podać deterministyczny, a gra losowy.
 */
export function resolveAttack(att: Actor, def: Actor, rng: () => number, out: AttackResult): void {
  out.landed = false;
  out.blocked = false;
  out.dodged = false;
  out.damage = 0;
  out.killed = false;
  out.staggered = false;
  if (def.stance === Stance.Dead) return;

  const w = weaponOf(att);
  const weaponSkill = skillOf(w);

  if (rng() >= hitChance(att, def)) {
    // pudło; nauka jest wolniejsza, ale jest — inaczej opłaca się bić tylko słabszych
    train(att, weaponSkill, false);
    if (def.dodgeMs > 0) {
      out.dodged = true;
      train(def, Skill.Dodge, true);
    }
    return;
  }

  out.landed = true;
  train(att, weaponSkill, true);

  let dmg =
    (w.dmgMin + rng() * (w.dmgMax - w.dmgMin)) *
    weaponWearFactor(att) *
    (1 + ((att.attrs[Attr.Str] ?? 0) - 50) * COMBAT.dmgPerStr);
  att.weaponWear = Math.min(100, att.weaponWear + w.wearPerHit);

  if (def.stance === Stance.Blocking) {
    const factor = Math.min(
      0.95,
      COMBAT.blockReduction + (def.skills[Skill.Block] ?? 0) * COMBAT.blockPerSkill,
    );
    const absorbed = dmg * factor;
    const cost = absorbed * COMBAT.blockStaminaPerDamage;
    if (def.stamina >= cost) {
      def.stamina -= cost;
      dmg -= absorbed;
      out.blocked = true;
      train(def, Skill.Block, true);
    } else {
      // blok przebity: cała wytrzymałość idzie w gwizdek, cios wchodzi w całości
      def.stamina = 0;
      def.stance = Stance.Stagger;
      def.stanceMs = COMBAT.staggerMs;
      train(def, Skill.Block, false);
    }
  }

  const armor = armorOf(def);
  const prot = protectionOf(def);
  if (prot > 0) {
    dmg -= prot;
    if (armor !== null) def.armorWear = Math.min(100, def.armorWear + armor.wearPerHit);
  }
  const floor = out.blocked ? 0 : COMBAT.dmgFloor;
  if (dmg < floor) dmg = floor;

  out.damage = dmg;
  def.hp -= dmg;

  if (def.hp <= 0) {
    def.hp = 0;
    def.stance = Stance.Dead;
    def.stanceMs = 0;
    out.killed = true;
    return;
  }

  // wyczerpany obrońca traci równowagę — dlatego blokowanie w nieskończoność nie działa
  if (def.stamina < COMBAT.staggerBelowStamina && def.stance !== Stance.Stagger) {
    def.stance = Stance.Stagger;
    def.stanceMs = COMBAT.staggerMs;
  }
  out.staggered = def.stance === Stance.Stagger;
}
