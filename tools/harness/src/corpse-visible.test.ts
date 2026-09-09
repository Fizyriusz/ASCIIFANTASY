import { describe, it, expect } from 'vitest';
import { createLightRig, renderWorld } from '@rpg/core';
import { wildCreatures, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore } from '@rpg/world';
import { mulberry32 } from '@rpg/world';
import { Stance, makeAttackResult } from '@rpg/rules';
import { Bestiary, drawBestiary } from '../../../apps/game/src/entities.js';
import type { MobReport } from '../../../apps/game/src/entities.js';
import { referenceScreen, wildContext } from './scene.js';
import type { Camera, Screen } from '@rpg/core';

/**
 * Czy ciało **widać**, a nie: czy jest na liście.
 *
 * Ten plik powstał po błędzie, którego nie złapał test kończący się na
 * `spriteList()`: gra wołała `drawSprites(..., lista, bestiary.mobs.length)`, więc
 * zwłoki — dopisywane na końcu listy — wypadały poza licznik i nie były malowane
 * nigdy. Wszystko po drodze było zielone: rekord istniał, miał pozycję, jasność
 * i klatkę. Dlatego ten test kończy się na **niepustych komórkach bufora znaków**.
 */

const SEED = 4242;
const CX = 128.5;
const CY = -467.5;
const EYE = 1.7;
const goblinDef = wildCreatures[0]!;

function raport(): MobReport {
  return { damage: 0, swung: false, blocked: false, dodged: false, missed: false, whiffed: false };
}

function scena() {
  const world = new ChunkStore(SEED, wildPack, 2);
  world.loadRing({ x: CX, y: CY });
  const b = new Bestiary(SEED, world);
  b.setClock(0);
  const gz = world.surfaceHeight(Math.floor(CX), Math.floor(CY), 1e6);
  const camera: Camera = {
    x: CX,
    y: CY,
    eyeZ: gz + EYE,
    yaw: 0,
    pitch: 0,
    fov: (74 * Math.PI) / 180,
  };
  b.spawnAround(CX, CY, gz);
  return { world, b, camera, gz };
}

/**
 * Kładzie trupa pięć metrów przed kamerą, ścieżką gry: byt ginie, `step` domyka
 * rozbłysk i dopiero wtedy zostaje z niego ciało.
 */
function polozTrupa(b: Bestiary, camera: Camera, world: ChunkStore, ilu = 1): void {
  const rig = createLightRig();
  const out = makeAttackResult();
  const rng = mulberry32(5);
  const gracz = { ...b.mobs[0]!.being, x: camera.x, y: camera.y, z: camera.eyeZ - EYE };
  for (let i = 0; i < ilu; i++) {
    const m = b.mobs[i];
    if (m === undefined) break;
    const tx = CX + 5 / CELL_METERS + i;
    const ty = CY;
    m.being.x = tx;
    m.being.y = ty;
    m.being.z = world.surfaceHeight(Math.floor(tx), Math.floor(ty), 1e6);
    m.being.actor.hp = 0;
    m.being.actor.stance = Stance.Dead;
  }
  for (let t = 0; t < 1000; t += 16) b.step(gracz, 16, rig, rng, out, raport());
}

/** Prostokąt ekranu, na który rzutuje się ciało, i ile w nim komórek przybyło. */
function zamalowane(
  screen: Screen,
  przed: Uint16Array | Uint32Array | number[],
  camera: Camera,
  ctx: { kv: number; horizon: number },
  c: { x: number; y: number; z: number },
): { r0: number; r1: number; ile: number; hRows: number } {
  const distM = Math.hypot(c.x - camera.x, c.y - camera.y) * CELL_METERS;
  const hRows = (goblinDef.heightM * ctx.kv) / distM;
  const baseRow = ctx.horizon - ((c.z - camera.eyeZ) * ctx.kv) / distM;
  const r0 = Math.max(0, Math.floor(baseRow - hRows));
  const r1 = Math.min(screen.rows, Math.ceil(baseRow));
  let ile = 0;
  for (let row = r0; row < r1; row++) {
    for (let col = 0; col < screen.cols; col++) {
      const i = row * screen.cols + col;
      if (screen.chars[i] !== przed[i]) ile++;
    }
  }
  return { r0, r1, ile, hRows };
}

describe('ciało widać w buforze znaków', () => {
  it('niepuste komórki w miejscu ciała, ta sama kamera i światło co w grze', () => {
    const { world, b, camera } = scena();
    polozTrupa(b, camera, world);
    const c = b.corpses[0];
    expect(c).toBeDefined();

    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(world, camera, screen, ctx);
    const przed = screen.chars.slice();

    // DOKŁADNIE ta sama funkcja, którą woła pętla gry — nie jej powtórzenie.
    const narysowane = drawBestiary(screen, camera, ctx, b);
    const { r0, r1, ile, hRows } = zamalowane(screen, przed, camera, ctx, c!);

    const raw = world.light(Math.floor(c!.x), Math.floor(c!.y));
    console.log(
      `ciało 5 m przed kamerą: lum ${c!.lum.toFixed(2)} (światło komórki ${raw >> 4}/${raw & 15}), ` +
        `wysokość ${hRows.toFixed(1)} wierszy, wiersze ${r0}..${r1} z ${screen.rows}, ` +
        `sprite'ów narysowanych ${narysowane}, komórek zamalowanych ${ile}`,
    );

    expect(narysowane).toBeGreaterThan(0);
    expect(ile).toBeGreaterThan(0);
  });

  it('ciało widać także wtedy, gdy nie został ani jeden żywy byt', () => {
    // To jest ten błąd wprost: licznik liczony z `mobs.length` daje tutaj zero,
    // więc lista jest pełna, a ekran pusty.
    const { world, b, camera } = scena();
    polozTrupa(b, camera, world, b.mobs.length);
    expect(b.mobs.length).toBe(0);
    expect(b.corpses.length).toBeGreaterThan(0);

    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(world, camera, screen, ctx);
    const przed = screen.chars.slice();
    drawBestiary(screen, camera, ctx, b);

    const widoczne = b.corpses
      .map((c) => zamalowane(screen, przed, camera, ctx, c).ile)
      .reduce((a, x) => a + x, 0);
    expect(widoczne).toBeGreaterThan(0);
  });

  it('ciało w ciemności jest niewidoczne, tak samo jak byt', () => {
    // Kontrola przeciwna: to nie jest „zawsze rysuj trupa". Zwłoki podlegają temu
    // samemu progowi widoczności, co byty — inaczej trup świeciłby w ciemnym lochu.
    const { world, b, camera } = scena();
    polozTrupa(b, camera, world);
    const c = b.corpses[0]!;
    c.lum = 0;

    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(world, camera, screen, ctx);
    const przed = screen.chars.slice();
    drawBestiary(screen, camera, ctx, b);
    expect(zamalowane(screen, przed, camera, ctx, c).ile).toBe(0);
  });
});
