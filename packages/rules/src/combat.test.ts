import { describe, it, expect } from 'vitest';
import { COMBAT, PLAYER, Weapon, Armor, wildCreatures, weapons } from '@rpg/content';
import { mulberry32 } from '@rpg/world';
import { Attr, Skill, Stance, makeActor } from './actor.js';
import type { Actor } from './actor.js';
import { equipArmor, equipWeapon } from './equipment.js';
import {
  beginAttack,
  beginBlock,
  beginDodge,
  defenseOf,
  hitChance,
  makeAttackResult,
  resolveAttack,
  stepCombat,
} from './combat.js';

function player(): Actor {
  return makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
}

function goblin(): Actor {
  const def = wildCreatures[0]!;
  return makeActor(def.hp, 60, def.attrs, def.skills);
}

describe('zamach jako odcinek czasu', () => {
  it('cios dochodzi po windupMs i zostawia byt w odbiciu', () => {
    const a = player();
    equipWeapon(a, Weapon.Club);
    const w = weapons[Weapon.Club]!;
    expect(beginAttack(a)).toBe(true);
    expect(a.stance).toBe(Stance.Windup);

    let doszedl = false;
    let t = 0;
    while (t < w.windupMs + 16 && !doszedl) {
      doszedl = stepCombat(a, 16);
      t += 16;
    }
    expect(doszedl).toBe(true);
    expect(t).toBeGreaterThanOrEqual(w.windupMs);
    expect(a.stance).toBe(Stance.Recover);
    expect(a.stanceMs).toBe(w.recoverMs);
  });

  it('w trakcie zamachu nie da się zacząć nic innego', () => {
    const a = player();
    beginAttack(a);
    expect(beginAttack(a)).toBe(false);
    expect(beginBlock(a)).toBe(false);
    expect(beginDodge(a)).toBe(false);
  });

  it('bez wytrzymałości nie ma zamachu', () => {
    const a = player();
    equipWeapon(a, Weapon.Club);
    a.stamina = 1;
    expect(beginAttack(a)).toBe(false);
    expect(a.stance).toBe(Stance.Idle);
  });

  it('maczuga zostawia dłużej otwartego niż sztylet', () => {
    const dag = weapons[Weapon.Dagger]!;
    const club = weapons[Weapon.Club]!;
    expect(club.windupMs + club.recoverMs).toBeGreaterThan(2 * (dag.windupMs + dag.recoverMs) * 0.7);
    expect(club.dmgMax).toBeGreaterThan(dag.dmgMax * 2);
  });
});

describe('rzut na trafienie', () => {
  it('unik w oknie czasowym obniża szansę trafienia', () => {
    const att = player();
    const def = goblin();
    const bez = hitChance(att, def);
    beginDodge(def);
    const zUnikiem = hitChance(att, def);
    // pełne 0,45 obrony nie zawsze da się odjąć — dolny klamr trzyma 5% ryzyka
    expect(zUnikiem).toBeCloseTo(Math.max(COMBAT.hitMin, bez - COMBAT.defDodgeWindow), 5);
    expect(zUnikiem).toBeLessThan(bez);
  });

  it('wytrącony z równowagi nie broni się wcale', () => {
    const def = goblin();
    def.stance = Stance.Stagger;
    expect(defenseOf(def)).toBe(0);
  });

  it('szansa trafienia nigdy nie jest pewna ani beznadziejna', () => {
    const mistrz = player();
    mistrz.skills[Skill.Blade] = 100;
    mistrz.attrs[Attr.Agi] = 100;
    const ofiara = goblin();
    expect(hitChance(mistrz, ofiara)).toBeLessThanOrEqual(COMBAT.hitMax);

    const cieply = makeActor(20, 20, [10, 10, 10, 10, 10, 10], [0, 0, 0, 0, 0]);
    const zwinny = goblin();
    zwinny.skills[Skill.Dodge] = 100;
    beginDodge(zwinny);
    expect(hitChance(cieply, zwinny)).toBeGreaterThanOrEqual(COMBAT.hitMin);
  });
});

describe('obrażenia i obrona', () => {
  const zawsze = () => 0; // rng: trafienie pewne, obrażenia minimalne

  it('blok zjada wytrzymałość i większość obrażeń', () => {
    const att = player();
    equipWeapon(att, Weapon.Club);
    const def = goblin();
    def.stamina = def.maxStamina;
    beginBlock(def);
    const out = makeAttackResult();
    const przed = def.hp;
    resolveAttack(att, def, zawsze, out);
    expect(out.blocked).toBe(true);
    expect(def.stamina).toBeLessThan(def.maxStamina);
    expect(przed - def.hp).toBeLessThan(weapons[Weapon.Club]!.dmgMin);
  });

  it('blok bez wytrzymałości pęka i wytrąca z równowagi', () => {
    const att = player();
    equipWeapon(att, Weapon.Club);
    const def = goblin();
    beginBlock(def);
    def.stamina = 1;
    const out = makeAttackResult();
    resolveAttack(att, def, zawsze, out);
    expect(out.blocked).toBe(false);
    expect(def.stance === Stance.Stagger || def.stance === Stance.Dead).toBe(true);
  });

  it('pancerz zdejmuje płaską wartość, ale cios zawsze coś zabiera', () => {
    const att = player();
    equipWeapon(att, Weapon.Dagger);
    const goly = goblin();
    const opancerzony = goblin();
    equipArmor(opancerzony, Armor.Mail);
    const out = makeAttackResult();

    resolveAttack(att, goly, zawsze, out);
    const bezPancerza = out.damage;
    resolveAttack(att, opancerzony, zawsze, out);
    expect(out.damage).toBeLessThan(bezPancerza);
    expect(out.damage).toBeGreaterThanOrEqual(COMBAT.dmgFloor);
  });

  it('trafienie w trupa nic nie robi', () => {
    const att = player();
    const def = goblin();
    def.stance = Stance.Dead;
    def.hp = 0;
    const out = makeAttackResult();
    resolveAttack(att, def, zawsze, out);
    expect(out.landed).toBe(false);
    expect(def.hp).toBe(0);
  });
});

/**
 * Symulacja starcia: obaj biją, gdy mogą, obrońca czasem blokuje albo unika.
 * Zwraca czas trwania w ms albo -1, gdy starcie się nie skończyło.
 */
function duel(seed: number, limitMs: number): { ms: number; hp: [number, number] } {
  const rng = mulberry32(seed);
  const a = player();
  equipWeapon(a, Math.floor(rng() * 3));
  equipArmor(a, Math.floor(rng() * 3));
  const b = goblin();
  equipWeapon(b, Math.floor(rng() * 3));

  const out = makeAttackResult();
  const strony: [Actor, Actor] = [a, b];
  const dt = 16;
  let t = 0;

  while (t < limitMs && a.stance !== Stance.Dead && b.stance !== Stance.Dead) {
    for (let i = 0; i < 2; i++) {
      const self = strony[i]!;
      const foe = strony[1 - i]!;
      if (self.stance === Stance.Dead) continue;
      if (stepCombat(self, dt)) resolveAttack(self, foe, rng, out);
      if (self.stance === Stance.Idle) {
        const r = rng();
        if (r < 0.55) beginAttack(self);
        else if (r < 0.75 && foe.stance === Stance.Windup) beginDodge(self);
        else if (r < 0.9) beginBlock(self);
      } else if (self.stance === Stance.Blocking && rng() < 0.2) {
        self.stance = Stance.Idle;
      }
    }
    t += dt;
  }
  return { ms: a.stance === Stance.Dead || b.stance === Stance.Dead ? t : -1, hp: [a.hp, b.hp] };
}

describe('dziesięć tysięcy starć', () => {
  it('bez NaN, bez ujemnego hp, bez nieskończonych pętli', () => {
    const czasy: number[] = [];
    let nierozstrzygniete = 0;
    for (let seed = 1; seed <= 10000; seed++) {
      const { ms, hp } = duel(seed, 120000);
      expect(Number.isFinite(hp[0])).toBe(true);
      expect(Number.isFinite(hp[1])).toBe(true);
      expect(hp[0]).toBeGreaterThanOrEqual(0);
      expect(hp[1]).toBeGreaterThanOrEqual(0);
      if (ms < 0) nierozstrzygniete++;
      else czasy.push(ms);
    }
    expect(nierozstrzygniete).toBe(0);

    czasy.sort((x, y) => x - y);
    const mediana = czasy[czasy.length >> 1]!;
    console.log(
      `mediana starcia ${(mediana / 1000).toFixed(1)} s, ` +
        `p05 ${(czasy[Math.floor(czasy.length * 0.05)]! / 1000).toFixed(1)} s, ` +
        `p95 ${(czasy[Math.floor(czasy.length * 0.95)]! / 1000).toFixed(1)} s`,
    );
    // Starcie ma trwać kilka sekund: krócej znaczy, że nie ma czasu na decyzję,
    // dłużej — że obrona jest silniejsza niż atak i walka zamienia się w oblężenie.
    // Zmierzone: mediana 5,1 s, p05 1,8 s, p95 12,0 s. Granice sa wąskie celowo —
    // mają pękać przy zmianie balansu, a nie dopiero przy zepsutej mechanice.
    expect(mediana).toBeGreaterThan(2500);
    expect(mediana).toBeLessThan(15000);
  });
});
