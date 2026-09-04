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
 * Rzut jest jeden — `baza + umiejętność + zręczność − obrona` — i decyduje o **sile**
 * ciosu, nie o jego istnieniu. Cios, który przeszedł geometrię i nie został zablokowany
 * ani ominięty unikiem, dochodzi zawsze; rzut przelicza się na jakość trafienia,
 * od muśnięcia po czysty cios.
 *
 * Zasada, z której to wynika: **jedynymi powodami zerowych obrażeń mają być powody,
 * które gracz widzi** — blok, unik, brak zasięgu. Kości produkujące niewidzialne zera
 * to ta sama klasa błędu co ciche ciosy z M3b: gra reaguje, ale nie ma czego odczytać.
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
  /**
   * jakość trafienia 0..1 — mnożnik obrażeń przed blokiem i pancerzem. Wystawiona,
   * bo gra musi umieć pokazać różnicę między muśnięciem a czystym ciosem; bez tego
   * skala jakości jest niewidoczna i wraca problem niewidzialnych zer.
   */
  quality: number;
  /** obrażenia po bloku i pancerzu */
  damage: number;
  killed: boolean;
  /** czy obrońca stracił równowagę */
  staggered: boolean;
}

export function makeAttackResult(): AttackResult {
  return {
    landed: false,
    blocked: false,
    dodged: false,
    quality: 0,
    damage: 0,
    killed: false,
    staggered: false,
  };
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
  a.regenDelayMs = COMBAT.staminaRegenDelayMs;
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
  a.regenDelayMs = COMBAT.staminaRegenDelayMs;
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

/**
 * Obrona: bierna plus umiejętność uniku. Okno uniku **nie** dokłada tu nic — jest
 * nietykalnością rozstrzyganą osobno (`resolveAttack`), a nie premią do rzutu.
 * Dwa mechanizmy na jeden efekt znaczą, że nie da się wyregulować żadnego z nich.
 */
export function defenseOf(def: Actor): number {
  if (def.stance === Stance.Dead || def.stance === Stance.Stagger) return 0;
  return COMBAT.defBase + (def.skills[Skill.Dodge] ?? 0) * COMBAT.defPerDodgeSkill;
}

/**
 * Rozstrzyga jeden cios. `rng` to funkcja 0..1 podana z zewnątrz — reguły nie znają
 * generatora, dzięki czemu test może podać deterministyczny, a gra losowy.
 *
 * Kolejność jest znacząca: unik rozstrzyga się **przed** rzutem, bo jest nietykalnością,
 * a nie utrudnieniem. Potem cios dochodzi zawsze i rzut decyduje wyłącznie o sile.
 */
export function resolveAttack(att: Actor, def: Actor, rng: () => number, out: AttackResult): void {
  out.landed = false;
  out.blocked = false;
  out.dodged = false;
  out.quality = 0;
  out.damage = 0;
  out.killed = false;
  out.staggered = false;
  if (def.stance === Stance.Dead) return;

  const w = weaponOf(att);
  const weaponSkill = skillOf(w);

  // Unik: cios mija ciało. Widoczny powód zera — gracz właśnie zobaczył, jak
  // przeciwnik odskakuje.
  if (def.dodgeMs > 0) {
    out.dodged = true;
    train(def, Skill.Dodge, true);
    train(att, weaponSkill, false);
    return;
  }

  // Jakość ciosu to **szansa trafienia przesunięta rzutem**: średnio wychodzi tyle,
  // ile wynosi szansa, więc dawne strojenie zostaje w mocy (kiedyś `p` mówiło, jaki
  // ułamek ciosów przechodzi w całości, dziś — jaki ułamek obrażeń przechodzi
  // średnio). Umiejętność działa przez `hitChance` tak samo mocno jak wcześniej,
  // tylko na skali zamiast w bramce. Dół jest podparty muśnięciem, bo zero obrażeń
  // wolno wyprodukować wyłącznie powodowi, który gracz widzi.
  const szansa = hitChance(att, def);
  const rzut = rng();
  const udany = rzut < szansa;
  train(att, weaponSkill, udany);

  out.landed = true;
  const jakosc = szansa + (0.5 - rzut);
  out.quality = jakosc < COMBAT.grazeDamage ? COMBAT.grazeDamage : jakosc > 1 ? 1 : jakosc;

  let dmg =
    (w.dmgMin + rng() * (w.dmgMax - w.dmgMin)) *
    out.quality *
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
      def.regenDelayMs = COMBAT.staminaRegenDelayMs;
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
