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
    // Niezmiennik geometryczny: im niżej oko, tym **wyżej** rzutują się bryły
    // nad nim, więc nieba nad horyzontem może tylko ubyć. Przyrost oznacza, że
    // kolumna zgubiła geometrię — i tak właśnie objawiał się błąd górnego frontu
    // (korona zasłaniała drzewo za sobą łatą nieba, rosnącą, gdy gracz schodził
    // w wąwóz). Pomiar sprzed poprawki: 1216 komórek nieba przy oku 3,4 m nad
    // gruntem, 1905 przy 1,0 m — przyrost o 689.
    const store = new ChunkStore(WILD_SEED, wildPack, 3);
    const screen = referenceScreen();
    const ctx = wildContext();
    const sky = skyColor(wildPack);
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
        renderWorld(store, cam, screen, ctx);
        const horizon = Math.round(ctx.horizon);
        let n = 0;
        for (let r = 0; r < horizon; r++) {
          for (let c = 0; c < screen.cols; c++) {
            const i = r * screen.cols + c;
            if ((screen.chars[i] ?? 0) !== 0 && (screen.colors[i] ?? 0) === sky) n++;
          }
        }
        expect(`(${x},${y}) oko ${dz}: ${n <= prev ? 'ok' : `PRZYROST z ${prev} na ${n}`}`).toBe(
          `(${x},${y}) oko ${dz}: ok`,
        );
        prev = n;
      }
    }
  });

  it('szybka ścieżka nie gubi geometrii względem maski — wszystkie sceny', () => {
    // Reguła w wersji, która się broni: **komórka nieba tam, gdzie pełny marsz
    // widzi bryłę, jest zawsze błędem**. Maska nie zna pojęcia „kolumna zamknięta",
    // więc idzie do końca zasięgu i jest wiarygodnym punktem odniesienia na to
    // jedno pytanie: czy tam w ogóle coś jest.
    //
    // Wersja dosłowna („żadnego nieba poniżej najwyższej bryły w kolumnie") nie
    // przechodzi i nie powinna: nadwieszenie (most, nadproże drzwi) legalnie ma
    // niebo pod bryłą, a scena miejska ma skończoną siatkę 64×64, więc promień
    // wychodzący poza jej krawędź legalnie widzi niebo poniżej dachów. Pomiar:
    // `ref-street` łamie regułę dosłowną w kolumnach 72-76 i jest to poprawny obraz.
    const problems: string[] = [];
    for (const f of everyScene()) {
      const full = referenceScreen();
      f.ctx.forceMask = 1;
      renderWorld(f.target, f.camera, full, f.ctx);
      f.ctx.forceMask = 0;
      let lost = 0;
      for (let i = 0; i < f.screen.chars.length; i++) {
        const fastSky = (f.screen.colors[i] ?? 0) === f.sky && (f.screen.chars[i] ?? 0) !== 0;
        const maskGeom = (full.chars[i] ?? 0) !== 0 && (full.colors[i] ?? 0) !== f.sky;
        if (fastSky && maskGeom) lost++;
      }
      if (lost > 0) problems.push(`${f.name}: ${lost} komórek nieba tam, gdzie maska widzi bryłę`);
    }
    expect(problems).toEqual([]);
  });
});
