import { describe, it, expect } from 'vitest';
import { drawSprites, compileSprite, renderWorld } from '@rpg/core';
import { PLAYER, wildCreatures, Weapon, Armor } from '@rpg/content';
import { mulberry32 } from '@rpg/world';
import {
  AiState,
  Stance,
  beginAttack,
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
import type { Being } from '@rpg/rules';
import { DUNGEON_VIEWS, dungeonScene, referenceScreen } from './scene.js';

const MPC = 2;
const DT = 16;

const def = wildCreatures[0];
if (def === undefined) throw new Error('paczka bez potworów');
const goblinArt = compileSprite(def.art, { r: def.r, g: def.g, b: def.b }, def.heightM, def.widthM);

function makePlayer(x: number, y: number, z: number, yaw: number, lum: number): Being {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  const b = makeBeing(a, x, y, z, yaw, -1, 1.9, 4.4);
  b.lum = lum;
  return b;
}

function makeGoblin(x: number, y: number, z: number, yaw: number, lum: number): Being {
  const a = makeActor(def!.hp, 60, def!.attrs, def!.skills);
  equipWeapon(a, def!.weapon);
  const b = makeBeing(a, x, y, z, yaw, 0, def!.walkMps, def!.runMps);
  b.lum = lum;
  return b;
}

/**
 * Pełne starcie w lochu, tym samym kodem, którym chodzi gra: percepcja z `@rpg/rules`,
 * AI, walka w czasie rzeczywistym i ruch po tej samej siatce, po której idą promienie.
 *
 * To jest test integracyjny, a nie jednostkowy: sprawdza, że warstwy sklejają się
 * ze sobą — bo każda z nich osobno przechodzi swoje testy, a mimo to potwór potrafi
 * nie zauważyć gracza stojącego mu na nodze, jeśli jednostki się nie zgadzają.
 */
function encounter(opts: { playerLum: number; graczAtakuje: boolean; limitS: number }) {
  const s = dungeonScene('corridor');
  const v = DUNGEON_VIEWS.corridor;
  const rng = mulberry32(2024);
  const out = makeAttackResult();

  const z = s.store.spanTop(Math.floor(v.x), Math.floor(v.y), 0);
  const gracz = makePlayer(v.x, v.y, z, v.yaw, opts.playerLum);
  const dx = Math.cos(v.yaw);
  const dy = Math.sin(v.yaw);
  const gx = v.x + dx * 6;
  const gy = v.y + dy * 6;
  const goblin = makeGoblin(gx, gy, s.store.spanTop(Math.floor(gx), Math.floor(gy), 0), v.yaw + Math.PI, 0.8);
  const intent = makeIntent();

  let t = 0;
  let zauwazyl = -1;
  while (t < opts.limitS * 1000) {
    updateAi(goblin, gracz, s.store, DT, rng, intent, MPC);
    // ruch potwora: bez kolizji, bo korytarz jest prosty — tu badamy walkę,
    // a kolizję sprawdza test chodzenia
    goblin.x += (intent.vx * DT) / 1000;
    goblin.y += (intent.vy * DT) / 1000;
    if (zauwazyl < 0 && goblin.ai !== AiState.Idle) zauwazyl = t;
    serviceSwing(goblin, gracz, DT, rng, out, MPC);

    if (opts.graczAtakuje) {
      if (gracz.actor.stance === Stance.Idle) beginAttack(gracz.actor);
      serviceSwing(gracz, goblin, DT, rng, out, MPC);
    } else {
      stepCombat(gracz.actor, DT);
    }

    if (gracz.actor.stance === Stance.Dead || goblin.actor.stance === Stance.Dead) break;
    t += DT;
  }
  return { t, zauwazyl, gracz, goblin, scene: s };
}

describe('spotkanie w lochu', () => {
  it('goblin zauważa oświetlonego gracza i dochodzi do walki', () => {
    const e = encounter({ playerLum: 0.9, graczAtakuje: true, limitS: 60 });
    expect(e.zauwazyl).toBeGreaterThanOrEqual(0);
    expect(e.zauwazyl).toBeLessThan(2000);
    // starcie kończy się czyimś trupem, a nie limitem czasu
    const trup = e.gracz.actor.stance === Stance.Dead || e.goblin.actor.stance === Stance.Dead;
    console.log(
      `starcie ${(e.t / 1000).toFixed(1)} s, zauważył po ${(e.zauwazyl / 1000).toFixed(2)} s, ` +
        `gracz ${e.gracz.actor.hp.toFixed(0)}/${e.gracz.actor.maxHp} hp, ` +
        `goblin ${e.goblin.actor.hp.toFixed(0)}/${e.goblin.actor.maxHp} hp`,
    );
    expect(trup).toBe(true);
    expect(e.t).toBeLessThan(60000);
    expect(Number.isFinite(e.gracz.actor.hp)).toBe(true);
    expect(e.gracz.actor.hp).toBeGreaterThanOrEqual(0);
    expect(e.goblin.actor.hp).toBeGreaterThanOrEqual(0);
  });

  it('gracz bez światła przechodzi obok niezauważony', () => {
    // To jest cała mechanika skradania: nie ma osobnego systemu ukrycia,
    // jest tylko luminancja bytu, ta sama, którą renderer maluje sprite'a.
    const e = encounter({ playerLum: 0, graczAtakuje: false, limitS: 5 });
    expect(e.zauwazyl).toBe(-1);
    expect(e.goblin.ai).toBe(AiState.Idle);
    expect(e.gracz.actor.hp).toBe(e.gracz.actor.maxHp);
  });

  it('potwór w zwarciu jest widoczny na ekranie, a nie tylko w liczbach', () => {
    // Sklejenie reguł z rendererem: byt, który AI postawiło przed graczem,
    // ma się pojawić w buforze znaków po `renderWorld`.
    const s = dungeonScene('corridor');
    const v = DUNGEON_VIEWS.corridor;
    const screen = referenceScreen();
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, s.ctx);
    renderWorld(s.store, s.camera, screen, s.ctx);

    const gx = v.x + Math.cos(v.yaw) * 1.5;
    const gy = v.y + Math.sin(v.yaw) * 1.5;
    const goblin = makeGoblin(gx, gy, s.store.spanTop(Math.floor(gx), Math.floor(gy), 0), v.yaw + Math.PI, 0.9);
    const narysowane = drawSprites(
      screen,
      s.camera,
      s.ctx,
      [
        {
          x: goblin.x,
          y: goblin.y,
          baseZ: goblin.z,
          yaw: goblin.yaw,
          frame: goblin.frame,
          lum: goblin.lum,
          frames: goblinArt,
        },
      ],
      1,
    );
    expect(narysowane).toBe(1);
    expect(screen.toText()).not.toBe(pusty.toText());
  });
});
