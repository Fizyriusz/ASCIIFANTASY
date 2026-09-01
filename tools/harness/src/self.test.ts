import { describe, it, expect } from 'vitest';
import { compileSprite, drawSprites, renderWorld } from '@rpg/core';
import type { Screen } from '@rpg/core';
import { COMBAT, Weapon, weapons, wildCreatures } from '@rpg/content';
import { drawCrosshair, drawSelf, dodgeProgress, windupProgress } from '@rpg/ui';
import { assertSnapshot } from './snapshot.js';
import { DUNGEON_VIEWS, dungeonScene, referenceScreen } from './scene.js';

const MPC = 2;
const def = wildCreatures[0]!;
const art = compileSprite(def.art, { r: def.r, g: def.g, b: def.b }, def.heightM, def.widthM);

type Postawa = 'idle' | 'windup-dagger' | 'windup-club' | 'block';

/**
 * Kadr walki z własną akcją: świat, przeciwnik w zwarciu, własna broń, celownik.
 * Ta sama kolejność rysowania co w grze.
 */
function kadr(postawa: Postawa): Screen {
  const s = dungeonScene('torch');
  const v = DUNGEON_VIEWS.torch;
  const screen = referenceScreen();
  renderWorld(s.store, s.camera, screen, s.ctx);

  const gx = v.x + Math.cos(v.yaw) * 0.75;
  const gy = v.y + Math.sin(v.yaw) * 0.75;
  drawSprites(
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
        lum: 0.85,
        frames: art,
      },
    ],
    1,
  );

  const bron = postawa === 'windup-club' ? weapons[Weapon.Club]! : weapons[Weapon.Dagger]!;
  drawSelf(screen, {
    windup: postawa === 'windup-dagger' || postawa === 'windup-club' ? 0.75 : -1,
    blocking: postawa === 'block',
    // unik nie rysuje niczego: jest ruchem, a nie znakiem — patrz `dodge.test.ts`
    dodge: 0,
    lum: 0.9,
    weapon: bron,
  });
  drawCrosshair(screen, 0.9);
  return screen;
}

function roznica(a: Screen, b: Screen): number {
  let n = 0;
  for (let i = 0; i < a.chars.length; i++) {
    if ((a.chars[i] ?? 0) !== (b.chars[i] ?? 0) || (a.colors[i] ?? 0) !== (b.colors[i] ?? 0)) n++;
  }
  return n;
}

describe('własne akcje w kadrze', () => {
  const postawy: Postawa[] = ['idle', 'windup-dagger', 'windup-club', 'block'];

  it('snapshoty czterech postaw', () => {
    for (const p of postawy) assertSnapshot(`self-${p}`, kadr(p).toText());
  });

  it('każda para postaw różni się co najmniej dwudziestoma komórkami', () => {
    // To jest ta sama miara co w M3b dla wyników ciosu: trzy różne decyzje mają
    // wyglądać jak trzy różne rzeczy, a nie jak jedna z wariantami.
    const kadry = postawy.map((p) => kadr(p));
    for (let i = 0; i < kadry.length; i++) {
      for (let j = i + 1; j < kadry.length; j++) {
        const n = roznica(kadry[i]!, kadry[j]!);
        expect(n).toBeGreaterThan(20);
      }
    }
  });

  it('broń jest w kadrze przez czas zamachu swojej broni i znika w odbiciu', () => {
    for (const w of weapons) {
      // pełny cykl: postęp rośnie od zera do jedynki, a w odbiciu jest -1
      expect(windupProgress(w.windupMs, w, true)).toBeCloseTo(0, 5);
      expect(windupProgress(w.windupMs / 2, w, true)).toBeCloseTo(0.5, 5);
      expect(windupProgress(0, w, true)).toBeCloseTo(1, 5);
      expect(windupProgress(w.recoverMs, w, false)).toBe(-1);
    }
    // szybka broń wysuwa się szybciej: przy tym samym czasie od startu
    const sztylet = weapons[Weapon.Dagger]!;
    const maczuga = weapons[Weapon.Club]!;
    const po100ms = (w: (typeof weapons)[number]) => windupProgress(w.windupMs - 100, w, true);
    expect(po100ms(sztylet)).toBeGreaterThan(po100ms(maczuga));
  });

  it('okno uniku przelicza się na postęp — używa go ruch, nie rysunek', () => {
    expect(dodgeProgress(COMBAT.dodgeWindowMs)).toBe(1);
    expect(dodgeProgress(COMBAT.dodgeWindowMs / 2)).toBeCloseTo(0.5, 5);
    expect(dodgeProgress(0)).toBe(0);
  });

  it('własna broń nie zasłania więcej niż jednej trzeciej sylwetki przeciwnika', () => {
    // Przy 1,4 m widać 18% sylwetki goblina (pomiar z M3b), a broń wchodzi w kadr
    // dokładnie w to miejsce. Ten test jest granicą tego kompromisu.
    const s = dungeonScene('torch');
    const v = DUNGEON_VIEWS.torch;
    const gx = v.x + Math.cos(v.yaw) * 0.75;
    const gy = v.y + Math.sin(v.yaw) * 0.75;
    const zByt = referenceScreen();
    renderWorld(s.store, s.camera, zByt, s.ctx);
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, s.ctx);
    drawSprites(
      zByt,
      s.camera,
      s.ctx,
      [
        {
          x: gx,
          y: gy,
          baseZ: s.store.spanTop(Math.floor(gx), Math.floor(gy), 0),
          yaw: v.yaw + Math.PI,
          frame: 0,
          lum: 0.85,
          frames: art,
        },
      ],
      1,
    );
    const sylwetka: number[] = [];
    for (let i = 0; i < zByt.chars.length; i++) {
      if ((zByt.chars[i] ?? 0) !== (pusty.chars[i] ?? 0)) sylwetka.push(i);
    }
    expect(sylwetka.length).toBeGreaterThan(50);

    const zBronia = kadr('windup-club');
    let zaslonione = 0;
    for (const i of sylwetka) {
      if ((zBronia.chars[i] ?? 0) !== (zByt.chars[i] ?? 0)) zaslonione++;
    }
    const udzial = zaslonione / sylwetka.length;
    console.log(
      `broń zasłania ${zaslonione} z ${sylwetka.length} komórek sylwetki (${(udzial * 100).toFixed(0)}%)`,
    );
    expect(udzial).toBeLessThan(1 / 3);
  });

  it('celownik jest w środku kadru i przygaszony', () => {
    const bez = referenceScreen();
    const z = referenceScreen();
    drawCrosshair(z, 1);
    expect(roznica(bez, z)).toBe(4);
    const cx = (z.cols / 2) | 0;
    const cy = (z.rows / 2) | 0;
    expect(z.chars[cy * z.cols + cx - 2]).toBe('-'.charCodeAt(0));
    expect(z.chars[cy * z.cols + cx]).toBe(0); // środek zostaje pusty
  });
});
