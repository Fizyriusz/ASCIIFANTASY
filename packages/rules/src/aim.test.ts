import { describe, it, expect } from 'vitest';
import { COMBAT, PLAYER, Weapon, wildCreatures } from '@rpg/content';
import { makeActor, Stance } from './actor.js';
import { makeBeing } from './being.js';
import type { Being } from './being.js';
import { equipWeapon } from './equipment.js';
import { beginAttack, makeAttackResult } from './combat.js';
import { serviceSwing, Swing } from './ai.js';

const MPC = 2;
const DT = 16;
const def = wildCreatures[0]!;

function gracz(x: number, y: number, z: number): Being {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  return makeBeing(a, x, y, z, 0, -1, 1.9, 4.4, 1.85, 1.7);
}

function goblin(x: number, y: number, z: number): Being {
  const a = makeActor(def.hp, def.stamina, def.attrs, def.skills);
  equipWeapon(a, def.weapon);
  return makeBeing(a, x, y, z, Math.PI, 0, def.walkMps, def.runMps, def.heightM, def.heightM * 0.85);
}

/** Doprowadza zamach do rozstrzygnięcia i zwraca jego wynik. */
function cios(kto: Being, wKogo: Being): Swing {
  const out = makeAttackResult();
  const rng = () => 0.01; // trafienie pewne: mierzymy warunek dojścia, nie rzut
  for (let t = 0; t < 4000; t += DT) {
    // zamach zaczynamy, kiedy tylko byt jest gotowy — po poprzednim ciosie
    // zostaje w odbiciu i nowego nie da się rozpocząć
    if (kto.actor.stance === Stance.Idle) beginAttack(kto.actor);
    const w = serviceSwing(kto, wKogo, DT, rng, out, MPC);
    if (w !== Swing.None) return w;
  }
  return Swing.None;
}

describe('celowanie w pionie', () => {
  it('patrzenie na sylwetkę trafia, patrzenie nad głowę nie', () => {
    const p = gracz(0, 0, 0);
    const g = goblin(1, 0, 0); // 2 m przed graczem
    const dist = 2;

    // środek sylwetki goblina: 0,7 m przy oku na 1,7 m
    p.pitch = Math.atan2(def.heightM * 0.5 - 1.7, dist);
    expect(cios(p, g)).toBe(Swing.Resolved);

    // poziomo przed siebie — przy dwóch metrach czubek głowy jest 8,5° niżej
    p.pitch = 0;
    expect(cios(p, g)).toBe(Swing.OffAim);

    // w ziemię tuż przed sobą
    p.pitch = -1.2;
    expect(cios(p, g)).toBe(Swing.OffAim);
  });

  it('okno rośnie z wysokością celu: na trolla patrzy się wyżej niż na wilka', () => {
    const p = gracz(0, 0, 0);
    const wilk = goblin(1, 0, 0);
    wilk.heightM = 0.9;
    const troll = goblin(1, 0, 0);
    troll.heightM = 2.6;

    p.pitch = 0.1; // lekko w górę
    expect(cios(p, troll)).toBe(Swing.Resolved);
    expect(cios(p, wilk)).toBe(Swing.OffAim);
  });

  it('margines z contentu jest tym, co rozszerza okno', () => {
    const p = gracz(0, 0, 0);
    const g = goblin(1, 0, 0);
    const doGlowy = Math.atan2(def.heightM - 1.7, 2);

    p.pitch = doGlowy + COMBAT.aimMarginRad * 0.9;
    expect(cios(p, g)).toBe(Swing.Resolved);
    p.pitch = doGlowy + COMBAT.aimMarginRad * 1.1;
    expect(cios(p, g)).toBe(Swing.OffAim);
  });
});

describe('pion działa w obie strony', () => {
  it('byt z przęsła nie trafia w dół ani nie jest trafiany z dołu', () => {
    // Ta sama odległość pozioma, która na płaskim daje trafienie.
    const naDole = gracz(0, 0, 0);
    const naGorze = goblin(0.75, 0, 4); // 1,5 m poziomo, 4 m wyżej

    naDole.pitch = Math.atan2(4 + def.heightM * 0.5 - 1.7, 1.5);
    expect(cios(naDole, naGorze)).toBe(Swing.OutOfReach);

    naGorze.pitch = Math.atan2(0 + 0.9 - (4 + def.heightM * 0.85), 1.5);
    expect(cios(naGorze, naDole)).toBe(Swing.OutOfReach);

    // kontrola: na tej samej wysokości ta odległość trafia
    const naPlaskim = goblin(0.75, 0, 0);
    naDole.pitch = Math.atan2(def.heightM * 0.5 - 1.7, 1.5);
    expect(cios(naDole, naPlaskim)).toBe(Swing.Resolved);
  });
});

describe('łuk poziomy mieści się w kadrze', () => {
  it('cel poza polem widzenia nie może zostać trafiony', () => {
    // Pole widzenia gry to 74°, czyli ±37°. Łuk ciosu musi być węższy.
    const polowaFov = (74 / 2) * (Math.PI / 180);
    expect(COMBAT.swingArcRad).toBeLessThan(polowaFov);

    const p = gracz(0, 0, 0);
    const g = goblin(Math.cos(0.9) * 1, Math.sin(0.9) * 1, 0); // 0,9 rad w bok
    p.pitch = Math.atan2(def.heightM * 0.5 - 1.7, 2);
    p.yaw = 0;
    expect(cios(p, g)).toBe(Swing.OffAngle);

    // ...a wewnątrz łuku ten sam cel jest trafiany
    p.yaw = 0.9;
    expect(cios(p, g)).toBe(Swing.Resolved);
  });
});
