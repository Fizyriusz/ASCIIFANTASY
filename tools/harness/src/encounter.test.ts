import { describe, it, expect } from 'vitest';
import { createLightRig, drawSprites, compileSprite, renderWorld } from '@rpg/core';
import { Armor, FEEDBACK, Frame, PLAYER, Weapon, wildCreatures, weapons, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, dungeonsNear, mulberry32 } from '@rpg/world';
import type { DungeonGraph } from '@rpg/world';
import {
  AiState,
  Stance,
  beginAttack,
  equipArmor,
  equipWeapon,
  makeActor,
  makeAttackResult,
  makeBeing,
  reachOf,
  serviceSwing,
  stepCombat,
  Swing,
} from '@rpg/rules';
import type { AttackResult, Being } from '@rpg/rules';
import { Bestiary } from '../../../apps/game/src/entities.js';
import type { Mob, MobReport } from '../../../apps/game/src/entities.js';
import { DUNGEON_VIEWS, dungeonScene, referenceScreen } from './scene.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;
const DT = 16;

const def = wildCreatures[0];
if (def === undefined) throw new Error('paczka bez potworów');
const goblinArt = compileSprite(def.art, { r: def.r, g: def.g, b: def.b }, def.heightM, def.widthM);

/**
 * Starcie prowadzone **tą samą ścieżką, którą chodzi gra**: `Bestiary.step`, czyli
 * percepcja, AI, ruch z kolizją świata i rozstrzyganie ciosów, plus ta sama kolizja
 * ciał przy ruchu gracza.
 *
 * Poprzednia wersja tego pliku poruszała bytem sama (`x += vx * dt`), z pominięciem
 * `Bestiary` i kolizji. Dlatego symulacja dawała medianę starcia 5,2 s, podczas gdy
 * w grze goblin machał pałką bez żadnego skutku: **test nie sprawdzał ścieżki, którą
 * chodzi gra**. To jest jedyny powód, dla którego ten plik wygląda, jak wygląda.
 */
interface Starcie {
  bestiary: Bestiary;
  gracz: Being;
  cel: Mob;
  raport: MobReport;
  rig: ReturnType<typeof createLightRig>;
}

function najblizszyLoch(): DungeonGraph {
  const graphs = dungeonsNear(SEED, START_X - 1024, START_Y - 1024, START_X + 1024, START_Y + 1024);
  let best: DungeonGraph | null = null;
  let bestD = Infinity;
  for (const g of graphs) {
    const d = (g.mouthX - START_X) ** 2 + (g.mouthY - START_Y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (best === null) throw new Error('brak lochu w zasięgu startu');
  return best;
}

function ustaw(dungeon: boolean): Starcie | null {
  const world = new ChunkStore(SEED, wildPack, 3);
  let px = START_X;
  let py = START_Y;
  let pz: number;

  if (dungeon) {
    const g = najblizszyLoch();
    let best = g.rooms[0]!;
    for (const r of g.rooms) if (r.level > best.level) best = r;
    px = best.x + best.w / 2;
    py = best.y + best.h / 2;
    world.loadRing({ x: px, y: py });
    pz = best.floorZ;
  } else {
    world.loadRing({ x: px, y: py });
    pz = world.surfaceHeight(Math.floor(px), Math.floor(py), 1e6);
  }

  const bestiary = new Bestiary(SEED, world);
  bestiary.spawnAround(px, py, pz);
  let cel: Mob | undefined;
  let bestD = Infinity;
  for (const m of bestiary.mobs) {
    const d = Math.hypot(m.being.x - px, m.being.y - py);
    if (d < bestD) {
      bestD = d;
      cel = m;
    }
  }
  if (cel === undefined) return null;

  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  // gracz metr od celu: starcie ma się zacząć od razu, a nie od marszu
  const gracz = makeBeing(a, cel.being.x - 1, cel.being.y, cel.being.z, 0, -1, 1.9, 4.4);
  gracz.lum = 0.9;

  return {
    bestiary,
    gracz,
    cel,
    raport: { damage: 0, swung: false, blocked: false, dodged: false, missed: false, whiffed: false },
    rig: createLightRig(),
  };
}

/** Jeden krok pętli gry: byty, a potem cios gracza, jeśli chce bić. */
function krok(s: Starcie, rng: () => number, out: AttackResult, atakuj = false): Swing {
  s.gracz.yaw = Math.atan2(s.cel.being.y - s.gracz.y, s.cel.being.x - s.gracz.x);
  s.bestiary.step(s.gracz, DT, s.rig, rng, out, s.raport);
  if (!atakuj) {
    stepCombat(s.gracz.actor, DT);
    return Swing.None;
  }
  if (s.gracz.actor.stance === Stance.Idle) beginAttack(s.gracz.actor);
  return serviceSwing(s.gracz, s.cel.being, DT, rng, out, CELL_METERS);
}

describe('starcie ścieżką gry', () => {
  it('każdy zamach kończy się rozstrzygnięciem, żaden nie ginie po cichu', () => {
    // Regresja z gry: goblin machał pałką w kółko, a w dzienniku nie było nic —
    // ani trafienia, ani pudła. `serviceSwing` wychodziło cicho, gdy cel był poza
    // zasięgiem, a AI zaczynała zamachy z 2,8 m przy zasięgu 2,0 m.
    for (const dungeon of [false, true]) {
      const s = ustaw(dungeon);
      if (s === null) continue;
      const rng = mulberry32(99);
      const out = makeAttackResult();
      let zamachy = 0;
      let ciche = 0;
      let wPowietrze = 0;
      let byl = false;

      for (let t = 0; t < 20000; t += DT) {
        const stanPrzed = s.cel.being.actor.stance;
        krok(s, rng, out);
        if (stanPrzed !== Stance.Windup && s.cel.being.actor.stance === Stance.Windup) {
          zamachy++;
          byl = true;
        }
        if (byl && s.cel.being.actor.stance !== Stance.Windup) {
          byl = false;
          if (s.raport.whiffed) wPowietrze++;
          else if (!s.raport.swung) ciche++;
        }
      }
      expect(zamachy).toBeGreaterThan(3);
      expect(ciche).toBe(0);
      // cios w powietrze jest legalnym wynikiem, ale ma być wyjątkiem, nie regułą
      expect(wPowietrze).toBeLessThan(zamachy / 2);
    }
  });

  it('stojąc bezczynnie w zasięgu przeciwnika traci się życie', () => {
    // Kryterium odbioru M3b brzmi „mam przegrać przez zły moment ataku" — a warunkiem
    // koniecznym jest to, żeby w ogóle dało się przegrać. Przed tą poprawką gracz
    // mógł stać nieruchomo dowolnie długo i nie tracił ani punktu.
    const s = ustaw(true) ?? ustaw(false);
    expect(s).not.toBeNull();
    const rng = mulberry32(7);
    const out = makeAttackResult();
    for (let t = 0; t < 20000; t += DT) krok(s!, rng, out);
    expect(s!.gracz.actor.hp).toBeLessThan(s!.gracz.actor.maxHp);
  });

  it('AI nie zaczyna zamachu spoza zasięgu broni', () => {
    const s = ustaw(false);
    expect(s).not.toBeNull();
    const rng = mulberry32(11);
    const out = makeAttackResult();
    const zasieg = reachOf(s!.cel.being);
    let poza = 0;
    let zamachy = 0;
    for (let t = 0; t < 20000; t += DT) {
      const stanPrzed = s!.cel.being.actor.stance;
      krok(s!, rng, out);
      if (stanPrzed !== Stance.Windup && s!.cel.being.actor.stance === Stance.Windup) {
        zamachy++;
        const d = Math.hypot(s!.cel.being.x - s!.gracz.x, s!.cel.being.y - s!.gracz.y) * CELL_METERS;
        if (d > zasieg) poza++;
      }
    }
    expect(zamachy).toBeGreaterThan(3);
    expect(poza).toBe(0);
  });

  it('gracz nie wchodzi w potwora i nie przepycha go bez końca', () => {
    const s = ustaw(false);
    expect(s).not.toBeNull();
    const rng = mulberry32(3);
    const out = makeAttackResult();
    const start = { x: s!.cel.being.x, y: s!.cel.being.y };
    let minDyst = Infinity;

    for (let t = 0; t < 10000; t += DT) {
      const dx = s!.cel.being.x - s!.gracz.x;
      const dy = s!.cel.being.y - s!.gracz.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = s!.gracz.x + ((dx / len) * ((1.9 / CELL_METERS) * DT)) / 1000;
      const ny = s!.gracz.y + ((dy / len) * ((1.9 / CELL_METERS) * DT)) / 1000;
      // ta sama kolizja ciał, co w `tryMove` gry
      if (!s!.bestiary.occupied(nx, ny, 1.1)) {
        s!.gracz.x = nx;
        s!.gracz.y = ny;
      }
      krok(s!, rng, out);
      minDyst = Math.min(
        minDyst,
        Math.hypot(s!.cel.being.x - s!.gracz.x, s!.cel.being.y - s!.gracz.y) * CELL_METERS,
      );
    }

    const przesuniety = Math.hypot(s!.cel.being.x - start.x, s!.cel.being.y - start.y) * CELL_METERS;
    // ciała są nieprzenikalne...
    expect(minDyst).toBeGreaterThan(0.9);
    // ...a cofanie ma budżet: dziesięć sekund nacierania to najwyżej kilka metrów
    expect(przesuniety).toBeLessThan(6);
  });

  it('starcie kończy się czyimś trupem, gdy gracz walczy', () => {
    const s = ustaw(false);
    expect(s).not.toBeNull();
    const rng = mulberry32(5);
    const out = makeAttackResult();
    let t = 0;
    for (; t < 60000; t += DT) {
      krok(s!, rng, out, true);
      if (s!.gracz.actor.stance === Stance.Dead || s!.cel.being.actor.stance === Stance.Dead) break;
    }
    console.log(
      `starcie ścieżką gry: ${(t / 1000).toFixed(1)} s, gracz ${s!.gracz.actor.hp.toFixed(0)}/45, ` +
        `goblin ${s!.cel.being.actor.hp.toFixed(0)}/${def.hp}`,
    );
    expect(
      s!.gracz.actor.stance === Stance.Dead || s!.cel.being.actor.stance === Stance.Dead,
    ).toBe(true);
    expect(t).toBeLessThan(60000);
  });

  it('trafienie zapala rozbłysk i klatkę Hit w liście sprajtów', () => {
    // Sprzężenie zwrotne kończy się w liście sprite'ów, a nie w polu obiektu:
    // ten test idzie do końca tej drogi, bo gracz zgłosił, że nie widzi ŻADNEGO
    // potwierdzenia trafienia.
    const s = ustaw(false);
    expect(s).not.toBeNull();
    const przed = s!.bestiary.spriteList().find((sp) => sp.x === s!.cel.being.x);
    expect(przed?.r).toBeUndefined();

    s!.bestiary.markHit(s!.cel);
    const po = s!.bestiary.spriteList().find((sp) => sp.x === s!.cel.being.x);
    expect(po?.r).toBeGreaterThan(def.r);
    expect(s!.cel.being.frame).toBe(Frame.Hit);
    expect(s!.cel.flashMs).toBeGreaterThan(0);

    // ...i gaśnie po zadanym czasie
    const out = makeAttackResult();
    const rng = mulberry32(1);
    for (let t = 0; t < FEEDBACK.hitFlashMs + FEEDBACK.hitHoldMs + 100; t += DT) krok(s!, rng, out);
    const potem = s!.bestiary.spriteList().find((sp) => sp.x === s!.cel.being.x);
    expect(potem?.r).toBeUndefined();
  });

  it('broń potwora ma zamach, na który da się zareagować', () => {
    for (const c of wildCreatures) {
      if (c.weapon === null) continue;
      expect(weapons[c.weapon]!.windupMs).toBeGreaterThanOrEqual(350);
    }
  });

  it('gracz bez światła przechodzi obok niezauważony', () => {
    // Skradanie: nie ma osobnego systemu ukrycia, jest luminancja bytu — ta sama,
    // którą renderer maluje sprite'a.
    const s = ustaw(true);
    expect(s).not.toBeNull();
    const rng = mulberry32(13);
    const out = makeAttackResult();
    s!.gracz.x = s!.cel.being.x - 6;
    for (let t = 0; t < 5000; t += DT) {
      s!.gracz.lum = 0;
      s!.gracz.yaw = 0;
      s!.bestiary.step(s!.gracz, DT, s!.rig, rng, out, s!.raport);
    }
    expect(s!.cel.being.ai).toBe(AiState.Idle);
    expect(s!.gracz.actor.hp).toBe(s!.gracz.actor.maxHp);
  });

  it('potwór w zwarciu jest widoczny na ekranie, a nie tylko w liczbach', () => {
    const s = dungeonScene('torch');
    const v = DUNGEON_VIEWS.torch;
    const screen = referenceScreen();
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, s.ctx);
    renderWorld(s.store, s.camera, screen, s.ctx);

    const gx = v.x + Math.cos(v.yaw) * 1.5;
    const gy = v.y + Math.sin(v.yaw) * 1.5;
    const narysowane = drawSprites(
      screen,
      s.camera,
      s.ctx,
      [
        {
          x: gx,
          y: gy,
          baseZ: s.store.spanTop(Math.floor(gx), Math.floor(gy), 0),
          yaw: v.yaw + Math.PI,
          frame: 0,
          lum: 0.9,
          frames: goblinArt,
        },
      ],
      1,
    );
    expect(narysowane).toBe(1);
    expect(screen.toText()).not.toBe(pusty.toText());
  });
});
