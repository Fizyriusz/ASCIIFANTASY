import { describe, it, expect } from 'vitest';
import { renderWorld } from '@rpg/core';
import { wildPack } from '@rpg/content';
import {
  CHUNK_SIZE,
  ChunkStore,
  clearDungeonCache,
  dungeonAt,
  dungeonPoiAt,
  generateChunk,
  mouthFloor,
} from '@rpg/world';
import { assertSnapshot } from './snapshot.js';
import {
  DUNGEON_VIEWS,
  WILD_SEED,
  dungeonScene,
  hutScene,
  nightScene,
  referenceScreen,
  wildContext,
  wildScene,
} from './scene.js';

describe('podziemia — snapshoty', () => {
  it('dungeon-corridor: korytarz w świetle pochodni', () => {
    const s = dungeonScene('corridor');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('dungeon-corridor', screen.toText());
  });

  it('dungeon-room-lit: komora z żagwiami', () => {
    const s = dungeonScene('room', { sources: true });
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('dungeon-room-lit', screen.toText());
  });

  it('torch-falloff: sama pochodnia, bez innych źródeł', () => {
    const s = dungeonScene('torch');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('torch-falloff', screen.toText());
  });

  it('cave-mouth: powierzchnia i podziemie w jednym kadrze', () => {
    const s = dungeonScene('mouth');
    s.ctx.light.daylight = wildPack.light.daylightDay;
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('cave-mouth', screen.toText());
  });

  it('doorway-through: widok przez otwarte drzwi', () => {
    const s = hutScene('door');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('doorway-through', screen.toText());
  });

  it('window-portal: widok z izby przez okno na teren', () => {
    const s = hutScene('window');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('window-portal', screen.toText());
  });

  it('night-outdoor: pustkowie nocą, tylko pochodnia', () => {
    const s = nightScene();
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('night-outdoor', screen.toText());
  });
});

describe('ciemność', () => {
  it('w lochu bez źródła światła nie widać nic', () => {
    // Punkt 3 DoD i zarazem cała mechanika podziemi: poza zasięgiem pochodni
    // ekran ma być pusty, a nie „trochę widoczny dla wygody".
    const s = dungeonScene('torch', { torch: false });
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    let painted = 0;
    for (let i = 0; i < screen.chars.length; i++) if ((screen.chars[i] ?? 0) !== 0) painted++;
    expect(painted).toBe(0);
  });

  it('pochodnia oświetla tylko swój zasięg', () => {
    const s = dungeonScene('torch');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    let painted = 0;
    for (let i = 0; i < screen.chars.length; i++) if ((screen.chars[i] ?? 0) !== 0) painted++;
    // coś widać, ale nie cały ekran — inaczej pochodnia nie miałaby zasięgu
    expect(painted).toBeGreaterThan(100);
    expect(painted).toBeLessThan(screen.chars.length * 0.85);
  });
});

describe('światło statyczne', () => {
  it('nie zależy od kolejności ładowania chunków', () => {
    // Pułapka nr 1 ze zlecenia: flood fill przez granicę chunka daje inne światło
    // przy każdym wejściu do tej samej jaskini. Propagacja jest ograniczona do
    // chunka z marginesem, więc kolejność nie ma prawa nic zmienić.
    const coords: Array<[number, number]> = [
      [-3, -7],
      [-4, -7],
      [-3, -6],
      [-4, -6],
      [-2, -7],
    ];
    const first = coords.map(([x, y]) => Array.from(generateChunk(WILD_SEED, x, y, wildPack).lights));
    for (let round = 0; round < 100; round++) {
      const order = [...coords].sort(
        (a, b) => ((a[0] * 31 + a[1] * 17 + round) % 7) - ((b[0] * 31 + b[1] * 17 + round) % 7),
      );
      if (round % 25 === 0) clearDungeonCache();
      const byCoord = new Map<string, number[]>();
      for (const [x, y] of order) {
        byCoord.set(`${x}:${y}`, Array.from(generateChunk(WILD_SEED, x, y, wildPack).lights));
      }
      coords.forEach(([x, y], i) => {
        expect(byCoord.get(`${x}:${y}`)).toEqual(first[i]);
      });
    }
  });

  it('loch jest ciemny, a powierzchnia jasna', () => {
    const store = new ChunkStore(WILD_SEED, wildPack, 2);
    const v = DUNGEON_VIEWS.corridor;
    store.loadRing({ x: v.x, y: v.y });
    // młodsza połówka bajtu to światło podziemne, starsza — powierzchni
    expect(store.light(Math.floor(v.x), Math.floor(v.y)) & 15).toBe(0);
    expect(store.light(Math.floor(v.x), Math.floor(v.y)) >> 4).toBeGreaterThan(8);
    // ta sama okolica na powierzchni: brak pustki, więc obie połówki jasne
    const far = store.light(Math.floor(v.x) + 40, Math.floor(v.y) + 40);
    expect(far >> 4).toBeGreaterThan(8);
  });
});

describe('spójność lochu', () => {
  it('10 000 lochów: klucz zawsze przed zamkiem', () => {
    // Klasyk generatorów lochów: klucz zamknięty za drzwiami, które otwiera.
    // Wykrywalny wyłącznie testem, bo w normalnej rozgrywce objawia się jako
    // „ten loch jakoś się nie kończy".
    let built = 0;
    let withLock = 0;
    for (let i = 0; i < 10000; i++) {
      const nx = (i % 100) - 50;
      const ny = Math.floor(i / 100) - 50;
      if (i % 500 === 0) clearDungeonCache();
      if (dungeonPoiAt(WILD_SEED, nx, ny) === 0) continue;
      const g = dungeonAt(WILD_SEED, nx, ny);
      if (g.rooms.length === 0) continue;
      built++;
      expect(g.entrance).toBe(0);
      if (g.locked < 0) continue;
      withLock++;
      // klucz leży w pokoju o mniejszym indeksie, czyli osiągalnym z wejścia
      // bez przechodzenia przez zamknięty pokój
      expect(g.keyRoom).toBeGreaterThan(0);
      expect(g.keyRoom).toBeLessThan(g.locked);
      const locked = g.rooms[g.locked];
      const key = g.rooms[g.keyRoom];
      expect(locked?.locked).toBe(true);
      expect(key?.hasKey).toBe(true);
    }
    expect(built).toBeGreaterThan(200);
    expect(withLock).toBe(built);
  });

  it('każdy pokój jest połączony korytarzem z poprzednim', () => {
    let checked = 0;
    for (let ny = -6; ny <= 6; ny++) {
      for (let nx = -6; nx <= 6; nx++) {
        if (dungeonPoiAt(WILD_SEED, nx, ny) === 0) continue;
        const g = dungeonAt(WILD_SEED, nx, ny);
        if (g.rooms.length === 0) continue;
        // łańcuch: n pokoi to n-1 korytarzy, każdy zaczyna się w poprzednim pokoju
        expect(g.corridors.length).toBe(g.rooms.length - 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('każde zejście da się pokonać z powrotem', () => {
    // Loch, do którego da się zejść, ale nie da się wyjść, jest błędem rozgrywki.
    // Kolizja gracza wpuszcza próg 0,6 m, więc tyle wolno mieć rampie wejściowej
    // i każdemu biegowi schodów w przeliczeniu na komórkę.
    const STEP_UP = 0.6;
    let checked = 0;
    for (let ny = -6; ny <= 6; ny++) {
      for (let nx = -6; nx <= 6; nx++) {
        if (dungeonPoiAt(WILD_SEED, nx, ny) === 0) continue;
        const g = dungeonAt(WILD_SEED, nx, ny);
        if (g.rooms.length === 0) continue;
        checked++;
        // Nachylenie biegu liczymy z ogniw łańcucha: korytarz `i` łączy pokój `i`
        // z pokojem `i+1`, więc różnica ich podłóg jest całym spadkiem biegu.
        for (let i = 0; i < g.corridors.length; i++) {
          const c = g.corridors[i];
          const a = g.rooms[i];
          const b = g.rooms[i + 1];
          if (c === undefined || a === undefined || b === undefined) continue;
          const len = Math.abs(c.x1 - c.x0) + Math.abs(c.y1 - c.y0);
          expect(len).toBeGreaterThan(0);
          expect(Math.abs(a.floorZ - b.floorZ) / len).toBeLessThanOrEqual(STEP_UP);
        }

        // rampa wejściowa, komórka po komórce od wylotu na zewnątrz
        let prev = mouthFloor(g, g.mouthX, g.mouthY, 1e6);
        for (let s = 1; s <= 12; s++) {
          const x = g.mouthX + g.mouthDirX * s;
          const y = g.mouthY + g.mouthDirY * s;
          const z = mouthFloor(g, x, y, 1e6);
          expect(z - prev).toBeLessThanOrEqual(STEP_UP);
          prev = z;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('komory mają różne wysokości stropu', () => {
    // Pułapka nr 5: stropy na jednej wysokości znaczą, że spany niczego nie wnoszą
    const g = dungeonAt(WILD_SEED, -1, -1);
    const heights = new Set(g.rooms.map((r) => Math.round((r.ceilZ - r.floorZ) * 10)));
    expect(heights.size).toBeGreaterThan(3);
  });

  it('loch mieści się w budżecie spanów na komórkę', () => {
    const v = DUNGEON_VIEWS.corridor;
    const chunk = generateChunk(
      WILD_SEED,
      Math.floor(v.x / CHUNK_SIZE),
      Math.floor(v.y / CHUNK_SIZE),
      wildPack,
    );
    let max = 0;
    for (let i = 0; i < chunk.counts.length; i++) {
      const c = chunk.counts[i] ?? 0;
      if (c > max) max = c;
    }
    expect(max).toBeLessThanOrEqual(4);
  });
});

describe('otwory w kolumnie', () => {
  it('przez drzwi widać wnętrze, a nie ścianę', () => {
    // Dowód, że maska pokrycia działa: w kolumnie na wprost otworu muszą pojawić
    // się materiały wnętrza (podłoga z desek), a nie sama ściana.
    const s = hutScene('door');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    const mid = Math.floor(screen.cols / 2);
    let empty = 0;
    for (let r = 0; r < screen.rows; r++) {
      if ((screen.chars[r * screen.cols + mid] ?? 0) === 0) empty++;
    }
    // kolumna przez drzwi jest zamalowana od podłogi po dach — gdyby maska nie
    // zadziałała, zostałby pas pustki w miejscu otworu
    expect(empty).toBeLessThan(screen.rows * 0.5);
  });

  it('sceny zewnętrzne nie wchodzą na ścieżkę maski', () => {
    // Strażnik wydajności, nie poprawności. O tym, czy kolumna idzie wolną ścieżką,
    // decyduje **wpis w paczce contentu** (`MaterialDef.transparent`). Oznaczenie
    // wody jako przezroczystej wysłałoby każdą scenę z rzeką na ścieżkę 1,8× i nie
    // wywaliłoby żadnego testu — obraz wyszedłby ten sam, tylko wolniej.
    const screen = referenceScreen();
    for (const view of ['hills', 'forest', 'river', 'ridge', 'seam'] as const) {
      const s = wildScene(view);
      const ctx = wildContext();
      renderWorld(s.store, s.camera, screen, ctx);
      expect(`${view}: ${ctx.maskedColumns}`).toBe(`${view}: 0`);
    }
  });

  it('licznik kolumn z maską nie jest martwy', () => {
    // Bez tego poprzedni test przechodziłby też wtedy, gdyby licznik nigdy nie rósł
    const s = hutScene('door');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    expect(s.ctx.maskedColumns).toBeGreaterThan(10);
    expect(s.ctx.maskedColumns).toBeLessThan(screen.cols);
  });

  it('kolumna bez otworu nie płaci za maskę', () => {
    // Szybka ścieżka ma zostać domyślna. Sprawdzamy to porównaniem obrazu:
    // scena bez materiałów przezroczystych renderuje się identycznie jak przed M2,
    // co jest testowane snapshotami wild-* i ref-*; tutaj pilnujemy samego faktu,
    // że pustkowie nie zawiera spanów przezroczystych poza chatami.
    const store = new ChunkStore(WILD_SEED, wildPack, 2);
    store.loadRing({ x: 0, y: 0 });
    let transparent = 0;
    for (let y = -30; y < 30; y++) {
      for (let x = -30; x < 30; x++) {
        const n = store.spanCount(x, y);
        for (let i = 0; i < n; i++) {
          const m = wildPack.materials[store.spanMaterial(x, y, i)];
          if (m?.transparent === true) transparent++;
        }
      }
    }
    expect(transparent).toBe(0);
  });
});
