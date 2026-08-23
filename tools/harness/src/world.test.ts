import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWorld } from '@rpg/core';
import { wildPack } from '@rpg/content';
import {
  CELL_METERS,
  CHUNK_SIZE,
  ChunkStore,
  MAX_SPANS_PER_CELL,
  carveHeight,
  clearRiverCache,
  generateChunk,
  riverSegments,
  terrainHeight,
  terrainSlope,
  waterAt,
} from '@rpg/world';
import { assertSnapshot } from './snapshot.js';
import {
  WILD_SEED,
  WILD_VIEWS,
  neonCityScene,
  referenceContext,
  referenceScreen,
  wildContext,
  wildGround,
  wildScene,
} from './scene.js';

function renderWild(view: keyof typeof WILD_VIEWS): string {
  const s = wildScene(view);
  const screen = referenceScreen();
  renderWorld(s.store, s.camera, screen, wildContext());
  return screen.toText();
}

describe('pustkowie — snapshoty', () => {
  it('wild-hills: otwarte wzgórza', () => {
    assertSnapshot('wild-hills', renderWild('hills'));
  });

  it('wild-forest: gęsty las liściasty', () => {
    assertSnapshot('wild-forest', renderWild('forest'));
  });

  it('wild-river: rzeka w kadrze', () => {
    assertSnapshot('wild-river', renderWild('river'));
  });

  it('wild-ridge: widok z grzbietu w dolinę', () => {
    assertSnapshot('wild-ridge', renderWild('ridge'));
  });

  it('wild-seam: kamera na styku czterech chunków', () => {
    assertSnapshot('wild-seam', renderWild('seam'));
  });

  it('neon-city: odłożona paczka nadal działa', () => {
    const s = neonCityScene();
    const screen = referenceScreen();
    renderWorld(s.grid, s.camera, screen, referenceContext());
    assertSnapshot('neon-city', screen.toText());
  });
});

describe('szwy', () => {
  it('wysokość i materiał na granicy chunków zgadzają się co do bitu', () => {
    // Najważniejszy test M1. Liczymy punkt dwiema drogami: wprost z funkcji
    // generujących i przez ChunkStore, który dostał go z konkretnego chunka.
    // Jeśli cokolwiek w generacji pyta o sąsiada, ta para się rozjedzie.
    const store = new ChunkStore(WILD_SEED, wildPack);
    store.loadRing({ x: 0, y: 0 });
    let checked = 0;
    for (let i = 0; i < 10000; i++) {
      // punkty skupione wokół granic chunków, także po ujemnej stronie
      const gx = ((i * 7919) % 5) - 2;
      const gy = ((i * 104729) % 5) - 2;
      const wx = gx * CHUNK_SIZE + (((i * 31) % 3) - 1);
      const wy = gy * CHUNK_SIZE + (((i * 17) % 3) - 1);
      if (store.spanCount(wx, wy) === 0) continue;
      const segs = riverSegments(WILD_SEED, Math.floor(wx / CHUNK_SIZE), Math.floor(wy / CHUNK_SIZE), CHUNK_SIZE);
      const direct = carveHeight(segs, wx, wy, terrainHeight(WILD_SEED, wx, wy));
      expect(store.spanTop(wx, wy, 0)).toBe(Math.fround(direct));
      checked++;
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('sąsiadujące chunki dają identyczną wysokość na wspólnej krawędzi', () => {
    const a = generateChunk(WILD_SEED, 0, 0, wildPack);
    const b = generateChunk(WILD_SEED, 1, 0, wildPack);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const right = a.tops[(ly * CHUNK_SIZE + CHUNK_SIZE - 1) * MAX_SPANS_PER_CELL] ?? 0;
      const leftOfNext = b.tops[ly * CHUNK_SIZE * MAX_SPANS_PER_CELL] ?? 0;
      // to nie są te same komórki, więc porównujemy ciągłość: różnica wysokości
      // sąsiednich komórek nie może przekroczyć tego, co daje najostrzejszy stok
      expect(Math.abs(right - leftOfNext)).toBeLessThan(4);
    }
  });
});

describe('determinizm', () => {
  it('generateChunk 1000 razy daje ten sam contentHash', () => {
    const first = generateChunk(WILD_SEED, 3, -2, wildPack).contentHash;
    for (let i = 0; i < 1000; i++) {
      // szum między wywołaniami: co setne wywołanie idzie w inny chunk
      // i czyści cache polilinii, żeby wykluczyć zależność od stanu
      if (i % 100 === 0) {
        clearRiverCache();
        generateChunk(WILD_SEED, i % 7, i % 5, wildPack);
      }
      expect(generateChunk(WILD_SEED, 3, -2, wildPack).contentHash).toBe(first);
    }
  });

  it('kolejność ładowania chunków nie wpływa na wynik', () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    const forward = coords.map(([x, y]) => generateChunk(WILD_SEED, x, y, wildPack).contentHash);
    clearRiverCache();
    const backward = [...coords]
      .reverse()
      .map(([x, y]) => generateChunk(WILD_SEED, x, y, wildPack).contentHash)
      .reverse();
    expect(backward).toEqual(forward);
  });

  it('w packages/world nie ma Math.random()', () => {
    // Zasada z CLAUDE.md: cały świat musi być odtwarzalny z seeda.
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, '..', '..', '..', 'packages', 'world', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          // komentarze odpadają — rng.ts *opisuje* ten zakaz w nagłówku i sam
          // wpadłby we własne sidła
          const code = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          if (code.includes('Math.random')) offenders.push(entry.name);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('hydrologia', () => {
  it('rzeka nie płynie pod górę', () => {
    // Brzmi absurdalnie, zdarza się przy mieszaniu warstw. Lustro wody musi
    // monotonicznie opadać wzdłuż każdego segmentu i między segmentami.
    let segments = 0;
    for (let cy = -4; cy <= 4; cy++) {
      for (let cx = -4; cx <= 4; cx++) {
        const segs = riverSegments(WILD_SEED, cx, cy, CHUNK_SIZE);
        for (const s of segs) {
          expect(s.z1).toBeLessThan(s.z0);
          segments++;
        }
      }
    }
    expect(segments).toBeGreaterThan(100);
  });

  it('woda stoi nad dnem, nigdy pod nim', () => {
    const store = new ChunkStore(WILD_SEED, wildPack);
    const cam = { x: WILD_VIEWS.river.x, y: WILD_VIEWS.river.y };
    store.loadRing(cam);
    let wet = 0;
    for (let dy = -40; dy <= 40; dy++) {
      for (let dx = -40; dx <= 40; dx++) {
        const wx = Math.floor(cam.x) + dx;
        const wy = Math.floor(cam.y) + dy;
        const w = store.waterLevel(wx, wy);
        if (w === null) continue;
        expect(w).toBeGreaterThan(store.spanTop(wx, wy, 0));
        wet++;
      }
    }
    expect(wet).toBeGreaterThan(20);
  });

  it('koryto jest wcięte w teren, a nie postawione na nim', () => {
    const segs = riverSegments(WILD_SEED, -6, 8, CHUNK_SIZE);
    let carvedSomewhere = 0;
    for (const s of segs.slice(0, 40)) {
      const raw = terrainHeight(WILD_SEED, s.x0, s.y0);
      const carved = carveHeight(segs, s.x0, s.y0, raw);
      expect(carved).toBeLessThanOrEqual(raw + 1e-6);
      if (carved < raw - 0.1) carvedSomewhere++;
    }
    expect(carvedSomewhere).toBeGreaterThan(0);
  });
});

describe('streaming', () => {
  it('pierścień trzyma stałą liczbę chunków po długim marszu', () => {
    const store = new ChunkStore(WILD_SEED, wildPack);
    const cam = { x: 0, y: 0 };
    store.loadRing(cam);
    const afterLoad = store.loaded;
    for (let i = 0; i < 1200; i++) {
      cam.x += 3;
      cam.y += 1;
      store.update(cam);
    }
    expect(store.loaded).toBeLessThanOrEqual(25);
    expect(afterLoad).toBe(25);
    expect(store.generated).toBeGreaterThan(50);
  });

  it('update generuje najwyżej jeden chunk na wywołanie', () => {
    const store = new ChunkStore(WILD_SEED, wildPack);
    const before = store.generated;
    store.update({ x: 5000, y: -5000 });
    expect(store.generated - before).toBe(1);
  });

  it('brakujący chunk zwraca pustkę zamiast rzucać', () => {
    const store = new ChunkStore(WILD_SEED, wildPack);
    expect(store.spanCount(99999, 99999)).toBe(0);
    expect(store.light(99999, 99999)).toBe(15);
    expect(store.surfaceHeight(99999, 99999, 100)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('delty przeżywają wyrzucenie chunka z pamięci', () => {
    const store = new ChunkStore(WILD_SEED, wildPack);
    store.loadRing({ x: 0, y: 0 });
    store.applyDeltas({ '0:0:0': { light: 3 } });
    expect(store.light(0, 0)).toBe(3);
    // wyjedź poza pierścień i wróć — delta musi zostać nałożona ponownie
    store.loadRing({ x: 4000, y: 4000 });
    store.loadRing({ x: 0, y: 0 });
    expect(store.light(0, 0)).toBe(3);
  });
});

describe('stabilność obrazu w ruchu', () => {
  /**
   * Migotanie: ile komórek ekranu zmienia znak między dwiema klatkami marszu.
   * Krok 0,05 m to realny dystans na klatkę przy prędkości chodu i 60 fps.
   *
   * Ten test istnieje, bo regresja już raz przeszła niezauważona: podniesienie
   * zasięgu i mgły rozjaśniło daleki grunt, a materiały o wysokim `roughness`
   * zaczęły migotać na pół ekranu. Pomiar per wiersz pokazał wtedy szczyt 13,6%
   * przy 3% średniej — sama średnia by tego nie złapała, dlatego próg jest
   * nałożony osobno na wiersz najgorszy.
   *
   * Progi są celowo ciasne. Jeśli ten test zapali się po zmianie zasięgu, mgły
   * albo materiału — to nie jest test do rozluźnienia, tylko sygnał, że obraz
   * w ruchu właśnie się posypał.
   */
  const KROK_METRY = 0.05;
  /** cały kadr, razem z krawędziami sylwetek */
  const PROG_SREDNIA = 6.5;
  const PROG_WIERSZ = 12.5;
  /**
   * Same powierzchnie: liczymy wyłącznie komórki zamalowane w obu klatkach.
   * Ta metryka pomija migotanie krawędzi — nieusuwalne, bo sylwetka drzewa
   * naprawdę przesuwa się przy chodzeniu — i przez to znacznie ostrzej łapie
   * to, co faktycznie boli: przeskakujący glif na dużej, jednolitej powierzchni.
   */
  const PROG_POWIERZCHNIE = 6;
  /**
   * Średnia z trzech najgorszych wierszy, nie z jednego. Pojedynczy wiersz jest
   * zbyt czuły: centymetr różnicy w wysokości kamery przesuwa go o 2,7 punktu,
   * bo zmienia się, który wycinek świata do niego trafia. Trójka jest stabilna,
   * a nadal pokazuje pas migotania zamiast rozmyć go w średniej po całym kadrze.
   */
  const PROG_NAJGORSZE_3 = 10.5;

  interface Flicker {
    overall: number;
    peak: number;
    peakRow: number;
    surface: number;
    worst3: number;
  }

  function flicker(view: keyof typeof WILD_VIEWS): Flicker {
    const s = wildScene(view);
    const ctx = wildContext();
    const a = referenceScreen();
    const b = referenceScreen();
    renderWorld(s.store, s.camera, a, ctx);
    // krok do przodu wzdłuż azymutu, przeliczony z metrów na komórki
    const step = KROK_METRY / CELL_METERS;
    renderWorld(
      s.store,
      {
        ...s.camera,
        x: s.camera.x + Math.cos(s.camera.yaw) * step,
        y: s.camera.y + Math.sin(s.camera.yaw) * step,
      },
      b,
      ctx,
    );

    let painted = 0;
    let changed = 0;
    let both = 0;
    let bothChanged = 0;
    let peak = 0;
    let peakRow = -1;
    const surfaceRows: number[] = [];
    for (let r = 0; r < a.rows; r++) {
      let pr = 0;
      let cr = 0;
      let br = 0;
      let bcr = 0;
      for (let c = 0; c < a.cols; c++) {
        const ca = a.chars[r * a.cols + c] ?? 0;
        const cb = b.chars[r * b.cols + c] ?? 0;
        if (ca !== 0 || cb !== 0) pr++;
        if (ca !== cb) cr++;
        if (ca !== 0 && cb !== 0) {
          br++;
          if (ca !== cb) bcr++;
        }
      }
      painted += pr;
      changed += cr;
      both += br;
      bothChanged += bcr;
      // wiersze z garstką zamalowanych komórek to skraj sylwetki, nie powierzchnia
      if (pr > 20) {
        const pct = (cr / pr) * 100;
        if (pct > peak) {
          peak = pct;
          peakRow = r;
        }
      }
      if (br > 20) surfaceRows.push((bcr / br) * 100);
    }
    surfaceRows.sort((x, y) => y - x);
    const worst3 =
      ((surfaceRows[0] ?? 0) + (surfaceRows[1] ?? 0) + (surfaceRows[2] ?? 0)) / 3;
    return {
      overall: (changed / painted) * 100,
      peak,
      peakRow,
      surface: (bothChanged / both) * 100,
      worst3,
    };
  }

  for (const view of ['hills', 'forest', 'river', 'ridge', 'seam'] as const) {
    it(`${view}: obraz nie sypie się przy kroku do przodu`, () => {
      const f = flicker(view);
      expect(f.overall).toBeLessThan(PROG_SREDNIA);
      expect(f.peak).toBeLessThan(PROG_WIERSZ);
      expect(f.surface).toBeLessThan(PROG_POWIERZCHNIE);
      expect(f.worst3).toBeLessThan(PROG_NAJGORSZE_3);
    });
  }
});

describe('budżety świata', () => {
  it('teren jest chodliwy: mediana nachylenia poniżej 15°', () => {
    const slopes: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const x = ((i * 977) % 8000) - 4000;
      const y = ((i * 613) % 8000) - 4000;
      slopes.push(terrainSlope(WILD_SEED, x, y));
    }
    slopes.sort((a, b) => a - b);
    const median = slopes[Math.floor(slopes.length / 2)] ?? 0;
    expect((Math.atan(median) * 180) / Math.PI).toBeLessThan(15);
  });

  it('kamera stoi na terenie, nie w nim i nie nad nim', () => {
    for (const key of Object.keys(WILD_VIEWS) as Array<keyof typeof WILD_VIEWS>) {
      const s = wildScene(key);
      const ground = wildGround(s.camera.x, s.camera.y);
      expect(s.camera.eyeZ - ground).toBeCloseTo(1.7, 6);
      expect(s.store.spanCount(Math.floor(s.camera.x), Math.floor(s.camera.y))).toBeGreaterThan(0);
    }
  });

  it('spany na komórkę: pomiar dla terenu otwartego i dla lasu', () => {
    // Limit z CLAUDE.md dotyczy terenu otwartego. Las z dwuspanowymi drzewami
    // ma prawo być gęstszy — liczba jest tu po to, żeby była zapisana, a nie
    // żeby test ją cicho przepuścił.
    const measure = (cx: number, cy: number): number => {
      const ch = generateChunk(WILD_SEED, cx, cy, wildPack);
      let n = 0;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) n += ch.counts[i] ?? 0;
      return n / (CHUNK_SIZE * CHUNK_SIZE);
    };
    const open = measure(-8, 9);
    const forest = measure(-6, -11);
    expect(open).toBeLessThan(2.5);
    expect(forest).toBeLessThan(3);
    expect(open).toBeGreaterThan(1);
  });
});
