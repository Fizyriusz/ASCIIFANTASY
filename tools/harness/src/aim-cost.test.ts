import { describe, it, expect } from 'vitest';
import { createLightRig } from '@rpg/core';
import { Armor, COMBAT, PLAYER, Weapon, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, mulberry32 } from '@rpg/world';
import {
  Stance,
  beginAttack,
  equipArmor,
  equipWeapon,
  makeActor,
  makeAttackResult,
  makeBeing,
  serviceSwing,
  Swing,
} from '@rpg/rules';
import { Bestiary } from '../../../apps/game/src/entities.js';
import type { MobReport } from '../../../apps/game/src/entities.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;
const DT = 16;

/**
 * Koszt celowania: ile ciosów, które trafiały przed regułą, przestaje trafiać.
 * `celuj` opisuje styl gracza — w środek sylwetki z ludzkim rozrzutem albo prosto
 * przed siebie.
 */
function pomiar(styl: 'w cel' | 'przed siebie', rozrzutStopni: number, margines: number) {
  const world = new ChunkStore(SEED, wildPack, 3);
  world.loadRing({ x: START_X, y: START_Y });
  const pz = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);
  const b = new Bestiary(SEED, world);
  b.spawnAround(START_X, START_Y, pz);
  let cel = b.mobs[0];
  let bestD = Infinity;
  for (const m of b.mobs) {
    const d = Math.hypot(m.being.x - START_X, m.being.y - START_Y);
    if (d < bestD) {
      bestD = d;
      cel = m;
    }
  }
  if (cel === undefined) return null;

  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  const p = makeBeing(a, cel.being.x - 1, cel.being.y, cel.being.z, 0, -1, 1.9, 4.4, 1.85, 1.7);
  p.lum = 0.9;

  const rng = mulberry32(31);
  const out = makeAttackResult();
  const rep: MobReport = {
    damage: 0,
    swung: false,
    blocked: false,
    dodged: false,
    missed: false,
    whiffed: false,
  };
  const rig = createLightRig();

  let ciosy = 0;
  let doszly = 0;
  let pozaPionem = 0;
  let pozaLukiem = 0;
  let pozaZasiegiem = 0;

  for (let t = 0; t < 60000; t += DT) {
    // gracz utrzymuje dystans walki i patrzy na cel
    const dx = cel.being.x - p.x;
    const dy = cel.being.y - p.y;
    const distM = Math.hypot(dx, dy) * CELL_METERS;
    if (distM > 1.9) {
      const len = Math.hypot(dx, dy) || 1;
      const nx = p.x + ((dx / len) * ((1.9 / CELL_METERS) * DT)) / 1000;
      const ny = p.y + ((dy / len) * ((1.9 / CELL_METERS) * DT)) / 1000;
      if (!b.occupied(nx, ny, 1.1)) {
        p.x = nx;
        p.y = ny;
      }
    }
    p.yaw = Math.atan2(dy, dx);

    if (styl === 'przed siebie') {
      p.pitch = 0;
    } else {
      const srodek = cel.being.z + cel.being.heightM * 0.5 - (p.z + p.eyeM);
      const idealny = Math.atan2(srodek, Math.max(0.1, distM));
      p.pitch = idealny + ((rng() * 2 - 1) * rozrzutStopni * Math.PI) / 180;
    }

    b.step(p, DT, rig, rng, out, rep);
    if (p.actor.stance === Stance.Idle) beginAttack(p.actor);
    const wynik = serviceSwing(p, cel.being, DT, rng, out, CELL_METERS);
    if (wynik === Swing.None) continue;
    ciosy++;
    if (wynik === Swing.Resolved) doszly++;
    else if (wynik === Swing.OffAim) pozaPionem++;
    else if (wynik === Swing.OffAngle) pozaLukiem++;
    else pozaZasiegiem++;
    // cel nieśmiertelny: mierzymy dochodzenie ciosów, nie długość starcia
    cel.being.actor.hp = cel.being.actor.maxHp;
    p.actor.hp = p.actor.maxHp;
  }
  const strata = ciosy === 0 ? 0 : (100 * (ciosy - doszly)) / ciosy;
  console.log(
    `margines ${(margines * 180 / Math.PI).toFixed(0)}°, styl „${styl}" (rozrzut ±${rozrzutStopni}°): ` +
      `ciosów ${ciosy}, doszło ${doszly}, poza pionem ${pozaPionem}, poza łukiem ${pozaLukiem}, ` +
      `poza zasięgiem ${pozaZasiegiem} → strata ${strata.toFixed(0)}%`,
  );
  return strata;
}

describe('koszt reguły celowania', () => {
  it('gracz celujący w przeciwnika nie traci ciosów', () => {
    // DoD 6 zlecenia M3f: powyżej 20% strat margines byłby za wąski. Mierzymy
    // ścieżką gry — `Bestiary.step` plus ta sama kolizja ciał co przy ruchu gracza.
    console.log(`margines w contencie: ${((COMBAT.aimMarginRad * 180) / Math.PI).toFixed(0)}°`);
    for (const rozrzut of [0, 5, 10, 20]) {
      const strata = pomiar('w cel', rozrzut, COMBAT.aimMarginRad);
      expect(strata).not.toBeNull();
      expect(strata!).toBeLessThan(20);
    }
  });

  it('gracz patrzący poziomo przed siebie mija goblina — i to jest cała reguła', () => {
    // Nie jest to strata „w normalnej walce": przy 2 m czubek głowy goblina jest
    // 8,5° poniżej poziomu, więc patrzenie przed siebie mija go z definicji.
    // Ta liczba jest tu po to, żeby było widać, o ile trzeba spuścić wzrok.
    const strata = pomiar('przed siebie', 0, COMBAT.aimMarginRad);
    expect(strata).not.toBeNull();
    expect(strata!).toBeGreaterThan(50);
  });
});
