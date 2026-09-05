import { describe, it, expect } from 'vitest';
import { createLightRig } from '@rpg/core';
import { CORPSE, Frame, WILD_SPAWN, wildPack } from '@rpg/content';
import { ChunkStore } from '@rpg/world';
import { Stance, makeAttackResult } from '@rpg/rules';
import { mulberry32 } from '@rpg/world';
import { Bestiary } from '../../../apps/game/src/entities.js';
import type { MobReport } from '../../../apps/game/src/entities.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;
/** Najgęstsze z szesnastu przemierzonych miejsc: 15 bytów w pierścieniu. */
const GESTO_X = 539.5;
const GESTO_Y = -56.5;

function raport(): MobReport {
  return { damage: 0, swung: false, blocked: false, dodged: false, missed: false, whiffed: false };
}

/** Bestiariusz z bytami wokół punktu startu i zegarem ustawionym na zero. */
function ustaw(): { b: Bestiary; z: number; world: ChunkStore } {
  const world = new ChunkStore(SEED, wildPack, 1);
  world.loadRing({ x: START_X, y: START_Y });
  const b = new Bestiary(SEED, world);
  b.setClock(0);
  const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);
  b.spawnAround(START_X, START_Y, z);
  return { b, z, world };
}

/**
 * Zabija pierwszy byt i domyka klatki, aż zgaśnie rozbłysk — dopiero wtedy byt
 * schodzi z listy i staje się ciałem. Zwraca pochodzenie zabitego.
 */
function zabij(b: Bestiary, gracz: { x: number; y: number; z: number }): string {
  const ofiara = b.mobs[0]!;
  const origin = ofiara.origin;
  ofiara.being.actor.hp = 0;
  ofiara.being.actor.stance = Stance.Dead;
  const rig = createLightRig();
  const out = makeAttackResult();
  const rng = mulberry32(7);
  const cel = {
    ...ofiara.being,
    x: gracz.x,
    y: gracz.y,
    z: gracz.z,
  };
  for (let t = 0; t < 1000; t += 16) b.step(cel, 16, rig, rng, out, raport());
  return origin;
}

describe('zwłoki', () => {
  it('zabity byt zostaje ciałem, a ciało nie jest bytem', () => {
    const { b, z } = ustaw();
    expect(b.mobs.length).toBeGreaterThan(0);
    const przed = b.mobs.length;
    const gracz = { x: b.mobs[0]!.being.x, y: b.mobs[0]!.being.y, z };
    const origin = zabij(b, gracz);

    expect(b.mobs.some((m) => m.origin === origin)).toBe(false);
    expect(b.mobs.length).toBe(przed - 1);
    expect(b.corpses.some((c) => c.origin === origin)).toBe(true);
  });

  it('ciało wraca po odejściu i powrocie, dopóki trwa okno', () => {
    // To jest zgłoszony błąd: „zabiłem goblina, odbiegłem kawałek, wróciłem —
    // ciała nie ma". Odejście musi przekroczyć promień zwolnienia.
    const { b, z } = ustaw();
    const gracz = { x: b.mobs[0]!.being.x, y: b.mobs[0]!.being.y, z };
    const origin = zabij(b, gracz);
    const gdzie = { ...b.corpses.find((c) => c.origin === origin)! };

    const daleko = START_X + WILD_SPAWN.releaseRadiusCells + 20;
    for (let i = 0; i < 3; i++) b.spawnAround(daleko, START_Y, z);
    expect(b.corpses.length).toBe(0);

    // wracamy w oknie: pół czasu życia zwłok
    b.setClock(CORPSE.minutes / 2);
    for (let i = 0; i < 3; i++) b.spawnAround(START_X, START_Y, z);
    const wrocilo = b.corpses.find((c) => c.origin === origin);
    expect(wrocilo).toBeDefined();
    // ciało leży tam, gdzie padło, a nie w miejscu z hasza
    expect(wrocilo!.x).toBeCloseTo(gdzie.x, 5);
    expect(wrocilo!.y).toBeCloseTo(gdzie.y, 5);
    // ...i nie wrócił przy okazji żywy goblin
    expect(b.mobs.some((m) => m.origin === origin)).toBe(false);
  });

  it('po oknie ciała już nie ma, a zabity dalej jest zabity', () => {
    const { b, z } = ustaw();
    const gracz = { x: b.mobs[0]!.being.x, y: b.mobs[0]!.being.y, z };
    const origin = zabij(b, gracz);

    const daleko = START_X + WILD_SPAWN.releaseRadiusCells + 20;
    for (let i = 0; i < 3; i++) b.spawnAround(daleko, START_Y, z);
    b.setClock(CORPSE.minutes + 1);
    for (let i = 0; i < 3; i++) b.spawnAround(START_X, START_Y, z);

    expect(b.corpses.some((c) => c.origin === origin)).toBe(false);
    expect(b.mobs.some((m) => m.origin === origin)).toBe(false);
    const delta = b.deltasToSave().find((d) => d.origin === origin);
    expect(delta?.dead).toBe(true);
    // wygasłe zwłoki nie noszą już pozycji ani czasu — plik nie ma czego pamiętać
    expect(delta?.diedAtMin).toBe(-1);
  });

  it('ciało nie liczy się do sufitu pierścienia', () => {
    const { b, z } = ustaw();
    const gracz = { x: b.mobs[0]!.being.x, y: b.mobs[0]!.being.y, z };
    const przed = b.mobs.length;
    zabij(b, gracz);
    // Sufit dotyczy bytów. Trup jako byt zjadałby miejsce w pierścieniu i po
    // kilkunastu zabójstwach świat przestawałby rodzić nowych w okolicy.
    expect(b.mobs.length).toBe(przed - 1);
    expect(b.corpses.length).toBe(1);
  });

  it('ciało nie zajmuje miejsca w kolizji', () => {
    const { b, z } = ustaw();
    const cel = b.mobs[0]!.being;
    const gdzie = { x: cel.x, y: cel.y, z };
    expect(b.occupied(gdzie.x, gdzie.y, 1.1)).toBe(true);
    zabij(b, gdzie);
    // trup w korytarzu lochu nie ma prawa zagrodzić przejścia
    expect(b.occupied(gdzie.x, gdzie.y, 1.1)).toBe(false);
  });

  it('sufit ciał wygasza najstarsze i na dobre', () => {
    // Sufit 12 jest zaworem bezpieczeństwa, nie codziennością: przemiar szesnastu
    // miejsc dał od 4 do 15 bytów w pierścieniu, więc na typowej łące nie ma kogo
    // zabić tyle razy. Ten test staje w najgęstszym znalezionym miejscu (15 bytów),
    // bo zawór, którego nikt nigdy nie sprawdził, jest tylko komentarzem.
    const world = new ChunkStore(SEED, wildPack, 1);
    world.loadRing({ x: GESTO_X, y: GESTO_Y });
    const b = new Bestiary(SEED, world);
    b.setClock(0);
    const z = world.surfaceHeight(Math.floor(GESTO_X), Math.floor(GESTO_Y), 1e6);
    b.spawnAround(GESTO_X, GESTO_Y, z);
    expect(b.mobs.length).toBeGreaterThan(CORPSE.cap);

    const rig = createLightRig();
    const out = makeAttackResult();
    const rng = mulberry32(3);
    const origins: string[] = [];
    let minuta = 0;

    for (const ofiara of [...b.mobs]) {
      minuta++;
      b.setClock(minuta); // każdy ginie minutę później: „najstarszy" ma być jednoznaczny
      origins.push(ofiara.origin);
      ofiara.being.actor.hp = 0;
      ofiara.being.actor.stance = Stance.Dead;
      const cel = { ...ofiara.being, x: GESTO_X, y: GESTO_Y, z };
      for (let t = 0; t < 500; t += 16) b.step(cel, 16, rig, rng, out, raport());
    }

    expect(origins.length).toBeGreaterThan(CORPSE.cap);
    expect(b.corpses.length).toBe(CORPSE.cap);

    const wygaszone = origins.slice(0, origins.length - CORPSE.cap);
    for (const o of wygaszone) {
      expect(b.corpses.some((c) => c.origin === o)).toBe(false);
      const d = b.deltasToSave().find((x) => x.origin === o);
      expect(d?.dead).toBe(true);
      expect(d?.diedAtMin).toBe(-1);
    }

    // wygaszony ponad sufit nie ma prawa wrócić przy następnym wejściu w pierścień
    const daleko = GESTO_X + WILD_SPAWN.releaseRadiusCells + 20;
    for (let i = 0; i < 3; i++) b.spawnAround(daleko, GESTO_Y, z);
    for (let i = 0; i < 3; i++) b.spawnAround(GESTO_X, GESTO_Y, z);
    for (const o of wygaszone) expect(b.corpses.some((c) => c.origin === o)).toBe(false);
    // ...a te w sufycie wracają, bo okno wciąż trwa
    expect(b.corpses.length).toBe(CORPSE.cap);
  });

  it('ciało trafia do listy sprite’ów klatką śmierci', () => {
    const { b, z } = ustaw();
    const gracz = { x: b.mobs[0]!.being.x, y: b.mobs[0]!.being.y, z };
    const gdzie = { x: gracz.x, y: gracz.y };
    zabij(b, gracz);
    const sprite = b.spriteList().find((s) => Math.abs(s.x - gdzie.x) < 1e-6);
    expect(sprite).toBeDefined();
    expect(sprite!.frame).toBe(Frame.Death);
  });
});
