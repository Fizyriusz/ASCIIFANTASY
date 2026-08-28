import { describe, it, expect } from 'vitest';
import { createLightRig, pack15, renderWorld, staticLum } from '@rpg/core';
import type { Camera, RenderContext, RenderTarget } from '@rpg/core';
import type { ContentPack } from '@rpg/content';
import { neonPack, wildPack } from '@rpg/content';
import { ChunkStore } from '@rpg/world';
import {
  DUNGEON_VIEWS,
  WILD_SEED,
  WILD_VIEWS,
  bridgeScene,
  dungeonScene,
  emptyScene,
  hutScene,
  interiorScene,
  nightScene,
  referenceCamera,
  referenceCity,
  referenceContext,
  referenceScreen,
  wildContext,
  wildScene,
} from './scene.js';

/**
 * Niezmienniki obrazu sprawdzane na **wszystkich** scenach naraz.
 *
 * Powód istnienia tego pliku: renderer zgubił geometrię za bryłą przecinającą
 * poziom oka i robił to od M0. Przy czarnym niebie brakująca góra wyglądała jak
 * cień i przeszła przez M0, M1 i M2 niezauważona. Pojedyncze snapshoty tego nie
 * łapią, bo trzeba mieć akurat tę scenę; niezmiennik łapie każdą.
 */

/** Kolor, jaki blit nadaje niebu danej paczki przy pełnym dniu. */
function skyColor(pack: ContentPack, ambient = 0.3, daylight = 1): number {
  const def = pack.materials[pack.skyMaterial];
  const rig = createLightRig();
  rig.ambient = ambient;
  rig.daylight = daylight;
  let lum = staticLum(rig, 15, 15);
  lum += (1 - lum) * (def?.emissive ?? 0);
  return pack15((def?.r ?? 0) * lum, (def?.g ?? 0) * lum, (def?.b ?? 0) * lum);
}

interface Frame {
  name: string;
  screen: ReturnType<typeof referenceScreen>;
  sky: number;
  target: RenderTarget;
  camera: Camera;
  ctx: RenderContext;
}

/** Wszystkie sceny repo w jednym miejscu — nowa scena wchodzi tu i do snapshotów. */
function everyScene(): Frame[] {
  const out: Frame[] = [];
  const neonSky = skyColor(neonPack);
  const wildSky = skyColor(wildPack);

  for (const [name, cam] of [
    ['ref-street', referenceCamera()],
    ['ref-turned', { ...referenceCamera(), yaw: referenceCamera().yaw + 0.7 }],
    ['ref-pitch-up', { ...referenceCamera(), pitch: 0.4 }],
  ] as const) {
    const screen = referenceScreen();
    const city = referenceCity();
    const ctx = referenceContext();
    renderWorld(city, cam, screen, ctx);
    out.push({ name, screen, sky: neonSky, target: city, camera: cam, ctx });
  }
  for (const [name, s] of [
    ['bridge', bridgeScene()],
    ['interior', interiorScene()],
    ['empty', emptyScene()],
  ] as const) {
    const screen = referenceScreen();
    const ctx = referenceContext();
    renderWorld(s.grid, s.camera, screen, ctx);
    out.push({ name, screen, sky: neonSky, target: s.grid, camera: s.camera, ctx });
  }
  for (const view of Object.keys(WILD_VIEWS) as Array<keyof typeof WILD_VIEWS>) {
    const s = wildScene(view);
    const screen = referenceScreen();
    const ctx = wildContext();
    renderWorld(s.store, s.camera, screen, ctx);
    out.push({ name: `wild-${view}`, screen, sky: wildSky, target: s.store, camera: s.camera, ctx });
  }
  for (const view of Object.keys(DUNGEON_VIEWS) as Array<keyof typeof DUNGEON_VIEWS>) {
    const s = dungeonScene(view, { sources: view === 'room' });
    if (view === 'exit' || view === 'approach') s.ctx.light.daylight = wildPack.light.daylightDay;
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    out.push({
      name: `dungeon-${view}`,
      screen,
      sky: skyColor(wildPack, 0.3, s.ctx.light.daylight),
      target: s.store,
      camera: s.camera,
      ctx: s.ctx,
    });
  }
  for (const view of ['door', 'window'] as const) {
    const s = hutScene(view);
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    out.push({ name: `hut-${view}`, screen, sky: wildSky, target: s.store, camera: s.camera, ctx: s.ctx });
  }
  const n = nightScene();
  const nightScreen = referenceScreen();
  renderWorld(n.store, n.camera, nightScreen, n.ctx);
  out.push({
    name: 'night-outdoor',
    screen: nightScreen,
    sky: skyColor(wildPack, 0.3, 0),
    target: n.store,
    camera: n.camera,
    ctx: n.ctx,
  });

  return out;
}

describe('niezmienniki obrazu', () => {
  it('opadanie oka nie odsłania nieba', () => {
    // Niezmiennik geometryczny: im niżej oko, tym **wyżej** rzutują się bryły nad
    // nim, więc komórek nieba nad horyzontem może tylko ubyć. Przyrost oznacza
    // zgubioną geometrię — tak objawiał się błąd górnego frontu z M2b: korona
    // zasłaniała drzewo za sobą łatą nieba, rosnącą, gdy gracz schodził w wąwóz.
    // Pomiar sprzed naprawy: 1216 komórek nieba przy oku 3,4 m nad gruntem,
    // 1905 przy 1,0 m — przyrost o 689.
    const store = new ChunkStore(WILD_SEED, wildPack, 3);
    const screen = referenceScreen();
    const ctx = wildContext();
    const maska = new Uint8Array(screen.cols * screen.rows);
    const spots: Array<[number, number, number]> = [
      [-339.5, -691.5, 3.6652],
      [-343.5, -695.5, 1.0472],
      [-335.5, -687.5, 4.7124],
    ];
    for (const [x, y, yaw] of spots) {
      store.loadRing({ x, y });
      const ground = store.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
      let prev = Infinity;
      for (const dz of [3.4, 2.6, 1.8, 1.0]) {
        const cam: Camera = { x, y, eyeZ: ground + dz, yaw, pitch: 0.05, fov: (74 * Math.PI) / 180 };
        ctx.skyMask = maska;
        renderWorld(store, cam, screen, ctx);
        ctx.skyMask = null;
        const horizon = Math.round(ctx.horizon);
        let n = 0;
        for (let r = 0; r < horizon; r++) {
          for (let c = 0; c < screen.cols; c++) if (maska[r * screen.cols + c] === 1) n++;
        }
        expect(`(${x},${y}) oko ${dz}: ${n <= prev ? 'ok' : `PRZYROST z ${prev} na ${n}`}`).toBe(
          `(${x},${y}) oko ${dz}: ok`,
        );
        prev = n;
      }
    }
  });

  it('nigdzie nie ma nadmiarowego nieba — wszystkie sceny', () => {
    // Kryterium odbioru M2c. Po zniknięciu szybkiej ścieżki nie ma już drugiej
    // implementacji do porównania, więc punktem odniesienia jest **marsz
    // referencyjny bez żadnych optymalizacji**: dla każdej komórki nieba puszczamy
    // z oka promień przez ten jeden wiersz i sprawdzamy próbka po próbce, aż do
    // zasięgu, czy nie przechodzi przez jakąkolwiek bryłę. Wolne i nieoptymalne
    // z premedytacją — służy wyłącznie testowi.
    //
    // Niebo tam, gdzie referencja widzi bryłę, znaczy zgubioną geometrię: dokładnie
    // to, co w M2b objawiało się łatami na koronach i fałszywym stropem.
    const KROK = 0.2; // komórki
    const problems: string[] = [];
    for (const f of everyScene()) {
      // Komórki nieba rozpoznajemy przez **drugi render bez materiału nieba**,
      // a nie po kolorze: w ciemnej scenie skała o luminancji 0,09 daje po
      // kwantyzacji dokładnie tę samą barwę co niebo o luminancji 0,06 i test
      // po kolorze zgłaszał ją jako niebo.
      const { screen, ctx, camera, target } = f;
      // Które komórki są niebem, mówi sam renderer: `skyMask` zapala bajt dokładnie
      // tam, gdzie kolumna skończyła bez trafienia i wypełnienie postawiło niebo.
      // Rozpoznawanie po barwie zawodzi w ciemnych scenach, a porównanie z renderem
      // bez nieba — odkąd mgła miesza barwę powierzchni z niebem.
      const maskaNieba = new Uint8Array(screen.cols * screen.rows);
      ctx.skyMask = maskaNieba;
      renderWorld(target, camera, screen, ctx);
      ctx.skyMask = null;
      const half = Math.tan(camera.fov * 0.5);
      const kh = (screen.cols * 0.5) / half;
      const kv = kh * (ctx.cellW / ctx.cellH);
      const horizon = screen.rows * 0.5 + Math.tan(camera.pitch) * kv;
      const dirX = Math.cos(camera.yaw);
      const dirY = Math.sin(camera.yaw);
      const planeX = -dirY * half;
      const planeY = dirX * half;
      const mpc = ctx.metersPerCell;
      let bad = 0;
      let first = '';
      for (let c = 0; c < screen.cols; c++) {
        const camPlane = (2 * (c + 0.5)) / screen.cols - 1;
        const rdx = dirX + planeX * camPlane;
        const rdy = dirY + planeY * camPlane;
        for (let r = 0; r < screen.rows; r++) {
          const i = r * screen.cols + c;
          if (maskaNieba[i] !== 1) continue;
          const slope = (horizon - (r + 0.5)) / kv;
          for (let d = KROK; d <= ctx.maxDepth; d += KROK) {
            const z = camera.eyeZ + slope * d * mpc;
            const cx = Math.floor(camera.x + rdx * d);
            const cy = Math.floor(camera.y + rdy * d);
            const n = target.spanCount(cx, cy);
            let hit = false;
            for (let k = 0; k < n; k++) {
              const m = ctx.materials[target.spanMaterial(cx, cy, k)];
              if (m === undefined || m.transparent) continue;
              if (target.spanBottom(cx, cy, k) <= z && target.spanTop(cx, cy, k) >= z) hit = true;
            }
            if (hit) {
              bad++;
              if (first === '') first = `kol ${c} wiersz ${r}, bryła na ${(d * mpc).toFixed(1)} m`;
              break;
            }
          }
        }
      }
      if (bad > 0) problems.push(`${f.name}: ${bad} komórek nadmiarowego nieba (${first})`);
    }
    expect(problems).toEqual([]);
  });
});
