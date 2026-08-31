import { describe, it, expect } from 'vitest';
import { Armor, PLAYER, WILD_SPAWN, Weapon, wildCreatures } from '@rpg/content';
import { SpanGrid, SpanFlags, mulberry32 } from '@rpg/world';
import {
  AiState,
  Stance,
  beginAttack,
  beginBlock,
  endBlock,
  equipArmor,
  equipWeapon,
  makeActor,
  makeAttackResult,
  makeBeing,
  makeIntent,
  serviceSwing,
  stepCombat,
  updateAi,
} from '@rpg/rules';
import type { Being, Intent } from '@rpg/rules';

const MPC = 2;
const DT = 16;
const HALL = 64;

const def = wildCreatures[0];
if (def === undefined) throw new Error('paczka bez potworów');

/** Płaska, oświetlona hala — walka ma tu zależeć od liczb, a nie od geometrii. */
function hall(): SpanGrid {
  const g = new SpanGrid(HALL, HALL);
  for (let y = 0; y < HALL; y++) {
    for (let x = 0; x < HALL; x++) {
      g.setColumn(x, y, [{ bottom: -4, top: 0, mat: 1, capMat: 1, flags: SpanFlags.Solid }]);
      g.setLight(x, y, 13);
    }
  }
  return g;
}

function gracz(): Being {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  const b = makeBeing(a, 32, 32, 0, 0, -1, 1.9, 4.4);
  b.lum = 0.9;
  return b;
}

function goblin(x: number, y: number, patrzyNa: { x: number; y: number }): { being: Being; intent: Intent } {
  const a = makeActor(def!.hp, def!.stamina, def!.attrs, def!.skills);
  equipWeapon(a, def!.weapon);
  // Zwrócony w stronę gracza: to jest spotkanie, a nie zasadzka od tyłu. Byt
  // odwrócony plecami nigdy nie zauważy skradającego się gracza i starcie
  // w ogóle się nie zacznie — sprawdza to osobny test percepcji.
  const b = makeBeing(a, x, y, 0, Math.atan2(patrzyNa.y - y, patrzyNa.x - x), 0, def!.walkMps, def!.runMps);
  b.lum = 0.8;
  return { being: b, intent: makeIntent() };
}

/**
 * Dwa style gry, bo to jest pytanie, na które ta miara ma odpowiedzieć: czy
 * wytrzymałość wymusza wybór. Styl **agresywny** bije, kiedy tylko ma z czego,
 * i zasłania się dopiero, gdy nie może bić. Styl **defensywny** blokuje każdy
 * zamach, który widzi. Jeśli oba wypadają tak samo, zasób nie wymusza niczego.
 */
export const Styl = { Agresywny: 0, Defensywny: 1 } as const;
export type Styl = (typeof Styl)[keyof typeof Styl];

function starcie(seed: number, ilu: number, styl: Styl): { wygrana: boolean; hp: number; sekundy: number } {
  const g = hall();
  const rng = mulberry32(seed);
  const out = makeAttackResult();
  const p = gracz();

  const wrogowie: { being: Being; intent: Intent }[] = [];
  for (let i = 0; i < ilu; i++) {
    const kat = (i / ilu) * Math.PI * 2 + rng();
    wrogowie.push(goblin(32 + Math.cos(kat) * 5, 32 + Math.sin(kat) * 5, p));
  }

  let t = 0;
  while (t < 120000) {
    let najblizszy: Being | null = null;
    let bestD = Infinity;
    let ktosZamierza = false;
    for (const w of wrogowie) {
      if (w.being.actor.stance === Stance.Dead) continue;
      const d = Math.hypot(w.being.x - p.x, w.being.y - p.y) * MPC;
      if (d < bestD) {
        bestD = d;
        najblizszy = w.being;
      }
      if (w.being.actor.stance === Stance.Windup && d < 3) ktosZamierza = true;
    }
    if (najblizszy === null) return { wygrana: true, hp: p.actor.hp, sekundy: t / 1000 };
    // Starcie kończy się też wtedy, gdy wszyscy żywi uciekli poza zasięg: ranny
    // goblin biegnie 3,8 m/s, a idący gracz 1,9 m/s, więc dogonić go nie sposób
    // i czekanie na jego śmierć mierzyłoby wytrwałość, a nie walkę.
    if (wszyscyUciekli(wrogowie, p)) return { wygrana: true, hp: p.actor.hp, sekundy: t / 1000 };

    // --- decyzje gracza ---
    p.yaw = Math.atan2(najblizszy.y - p.y, najblizszy.x - p.x);
    const wZasiegu = bestD < 2.2;
    if (p.actor.stance === Stance.Idle) {
      if (p.actor.exhausted) {
        // nic: stojąc regeneruje 24/s, blokując 7/s — wyczerpany blok to pułapka
      } else if (styl === Styl.Defensywny && ktosZamierza) {
        beginBlock(p.actor);
      } else if (wZasiegu) {
        beginAttack(p.actor);
      } else if (styl === Styl.Agresywny && ktosZamierza) {
        beginBlock(p.actor);
      } else {
        // podchodzi do najbliższego: stojący w miejscu gracz nie jest miarą walki,
        // tylko miarą cierpliwości przeciwnika
        const dx = najblizszy.x - p.x;
        const dy = najblizszy.y - p.y;
        const len = Math.hypot(dx, dy);
        p.x += (dx / len) * ((1.9 / MPC) * DT) / 1000;
        p.y += (dy / len) * ((1.9 / MPC) * DT) / 1000;
      }
    } else if (p.actor.stance === Stance.Blocking && (!ktosZamierza || p.actor.exhausted)) {
      endBlock(p.actor);
    }
    serviceSwing(p, najblizszy, DT, rng, out, MPC);

    // --- byty ---
    for (const w of wrogowie) {
      if (w.being.actor.stance === Stance.Dead) continue;
      updateAi(w.being, p, g, DT, rng, w.intent, MPC);
      w.being.x += (w.intent.vx * DT) / 1000;
      w.being.y += (w.intent.vy * DT) / 1000;
      serviceSwing(w.being, p, DT, rng, out, MPC);
    }

    if (p.actor.stance === Stance.Dead) return { wygrana: false, hp: 0, sekundy: t / 1000 };
    t += DT;
  }
  return { wygrana: p.actor.hp > 0, hp: p.actor.hp, sekundy: t / 1000 };
}

/** Czy każdy żywy przeciwnik ucieka i jest już daleko. */
function wszyscyUciekli(wrogowie: { being: Being }[], p: Being): boolean {
  let zywi = 0;
  for (const w of wrogowie) {
    if (w.being.actor.stance === Stance.Dead) continue;
    zywi++;
    const d = Math.hypot(w.being.x - p.x, w.being.y - p.y) * MPC;
    if (w.being.ai !== AiState.Fleeing || d < 15) return false;
  }
  return zywi > 0;
}

function seria(ilu: number, styl: Styl, prob = 200) {
  let wygrane = 0;
  const hp: number[] = [];
  const czasy: number[] = [];
  for (let s = 1; s <= prob; s++) {
    const r = starcie(s * 977 + ilu, ilu, styl);
    if (r.wygrana) wygrane++;
    hp.push(r.hp);
    czasy.push(r.sekundy);
  }
  hp.sort((a, b) => a - b);
  czasy.sort((a, b) => a - b);
  return {
    winrate: wygrane / prob,
    medHp: hp[hp.length >> 1] ?? 0,
    medCzas: czasy[czasy.length >> 1] ?? 0,
  };
}

describe('groźba wychodzi z liczebności, nie z siły', () => {
  it('jeden, dwóch i trzech goblinów to trzy różne walki', () => {
    const wynik = (ilu: number, styl: Styl) => seria(ilu, styl);
    const agr = [wynik(1, Styl.Agresywny), wynik(2, Styl.Agresywny), wynik(3, Styl.Agresywny)];
    const def_ = [wynik(1, Styl.Defensywny), wynik(2, Styl.Defensywny), wynik(3, Styl.Defensywny)];

    for (let i = 0; i < 3; i++) {
      console.log(
        `${i + 1} goblin(y) — agresywnie: wygrane ${(agr[i]!.winrate * 100).toFixed(0)}%, ` +
          `mediana hp ${agr[i]!.medHp.toFixed(0)}/45, czas ${agr[i]!.medCzas.toFixed(1)} s | ` +
          `defensywnie: wygrane ${(def_[i]!.winrate * 100).toFixed(0)}%, ` +
          `mediana hp ${def_[i]!.medHp.toFixed(0)}/45, czas ${def_[i]!.medCzas.toFixed(1)} s`,
      );
    }

    // Pojedynczy przeciwnik ma być rozgrzewką, a nie zagrożeniem — obrażeń goblina
    // nie ruszamy, bo groźba ma iść z liczby.
    expect(agr[0]!.winrate).toBeGreaterThan(0.9);
    // ...a trójka ma zbierać wyraźnie więcej życia niż pojedynczy
    expect(agr[2]!.medHp).toBeLessThan(agr[0]!.medHp - 5);
    // Styl ma znaczenie: gdyby wytrzymałość niczego nie wymuszała, oba wypadłyby
    // tak samo. Blokowanie każdego zamachu kosztuje wytrzymałość, więc kończy się
    // dłuższą walką — i to jest właśnie ten wybór.
    expect(def_[0]!.medCzas).toBeGreaterThan(agr[0]!.medCzas);
  });

  it('rozmiar grupy jest danymi, nie liczbą w kodzie gry', () => {
    expect(WILD_SPAWN.packMin).toBeGreaterThanOrEqual(1);
    expect(WILD_SPAWN.packMax).toBeGreaterThanOrEqual(WILD_SPAWN.packMin);
    expect(WILD_SPAWN.oneInClusters).toBeGreaterThan(1);
  });
});
