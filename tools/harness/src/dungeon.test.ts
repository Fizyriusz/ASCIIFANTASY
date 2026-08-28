import { describe, it, expect } from 'vitest';
import { compileMaterials, renderWorld, torchFlicker } from '@rpg/core';
import type { Screen } from '@rpg/core';
import { inkOf, neonPack, wildPack } from '@rpg/content';
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

/** Indeks trawy w paczce wild — materiał kontrolny „zwykły teren". */
const WILD_GROUND = 1;
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

  it('cave-exit-from-inside: wylot tunelu widziany z piętnastu metrów', () => {
    const s = dungeonScene('exit');
    s.ctx.light.daylight = wildPack.light.daylightDay;
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('cave-exit-from-inside', screen.toText());
  });

  it('cave-approach: wejście z trzydziestu metrów, w dzień', () => {
    const s = dungeonScene('approach', { torch: false });
    s.ctx.light.daylight = wildPack.light.daylightDay;
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    assertSnapshot('cave-approach', screen.toText());
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
    // „Nie cały ekran" jest złym testem zasięgu: w korytarzu dwumetrowym ściany
    // i strop są kilka metrów od oka, więc przy każdym rozsądnym zasięgu pochodni
    // brzegi kadru są zamalowane. Zasięg widać w **głębi**: koniec korytarza dalej
    // niż pochodnia rzutuje się w okolice punktu zbiegu i ma być czarny.
    const s = dungeonScene('torch');
    const screen = referenceScreen();
    renderWorld(s.store, s.camera, screen, s.ctx);
    let painted = 0;
    for (let i = 0; i < screen.chars.length; i++) if ((screen.chars[i] ?? 0) !== 0) painted++;
    expect(painted).toBeGreaterThan(1000);

    // okno tuż nad punktem zbiegu: dalszy koniec korytarza, bez podłogi u dołu kadru
    const c0 = Math.floor(screen.cols / 2) - 8;
    const r0 = Math.floor(screen.rows / 2) - 8;
    let deep = 0;
    for (let r = r0; r < r0 + 8; r++) {
      for (let c = c0; c < c0 + 16; c++) if ((screen.chars[r * screen.cols + c] ?? 0) !== 0) deep++;
    }
    expect(deep).toBe(0);
  });
});

describe('pochodnia', () => {
  it('przy nieruchomej kamerze obraz stoi', () => {
    // Migotanie ma być czuć w jasności, a nie w geometrii. Metryka jest ta sama
    // co w M1c (udział komórek, które zmieniły glif, ważony pokryciem atramentem),
    // tylko zamiast kroku gracza zmienia się faza płomienia. Progi z pomiaru przy
    // dodaniu: 0,62% komórek, 0,10% ważone — dla porównania marsz w lesie daje
    // 0,34-0,55% ważonej.
    const s = dungeonScene('corridor');
    const frames: Screen[] = [];
    for (let i = 0; i < 10; i++) {
      const screen = referenceScreen();
      s.ctx.light.torchFlicker = torchFlicker(i / 60);
      renderWorld(s.store, s.camera, screen, s.ctx);
      frames.push(screen);
    }
    let changed = 0;
    let painted = 0;
    let ink = 0;
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1];
      const b = frames[k];
      if (a === undefined || b === undefined) continue;
      for (let i = 0; i < a.chars.length; i++) {
        const ca = a.chars[i] ?? 0;
        const cb = b.chars[i] ?? 0;
        if (ca !== 0 || cb !== 0) painted++;
        if (ca !== cb) changed++;
        ink += Math.abs(inkOf(ca) - inkOf(cb));
      }
    }
    expect((100 * changed) / painted).toBeLessThan(1.2);
    expect((100 * ink) / painted).toBeLessThan(0.2);
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

        // Rampa wejściowa, komórka po komórce od wylotu na zewnątrz. Wcięcie
        // skręca, więc trasa idzie łamaną: cztery komórki wzdłuż osi tunelu,
        // potem prostopadle.
        let prev = mouthFloor(g, g.mouthX, g.mouthY, 1e6);
        for (let s = 1; s <= 15; s++) {
          const along = s <= 4 ? s : 4;
          const side = s <= 4 ? 0 : s - 4;
          const x = g.mouthX + g.mouthDirX * along + g.bendX * side;
          const y = g.mouthY + g.mouthDirY * along + g.bendY * side;
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

describe('wyjście z lochu', () => {
  it('wylot jest najjaśniejszym obszarem kadru', () => {
    // Kryterium odbioru nieba, w wersji odpornej: patrząc w głąb tunelu na
    // wysokości oka, **środek kadru jest jaśniejszy od boków**. Skanowanie okna
    // po całym kadrze okazało się kruche — z pochodnią najjaśniejszą plamą jest
    // podłoga pod nogami gracza, co jest fizycznie w porządku i nie ma nic
    // wspólnego z tym, czy da się znaleźć wyjście.
    for (const torch of [true, false]) {
      const s = dungeonScene('exit', { torch });
      s.ctx.light.daylight = wildPack.light.daylightDay;
      const screen = referenceScreen();
      renderWorld(s.store, s.camera, screen, s.ctx);
      const horizon = Math.round(s.ctx.horizon);
      const mid = Math.floor(screen.cols / 2);
      let centre = 0;
      let cn = 0;
      let flank = 0;
      let fn = 0;
      for (let r = horizon - 6; r <= horizon + 2; r++) {
        for (let c = 0; c < screen.cols; c++) {
          const i = r * screen.cols + c;
          const p = screen.colors[i] ?? 0;
          const b = ((p >> 10) & 31) + ((p >> 5) & 31) + (p & 31);
          if (Math.abs(c - mid) <= 15) {
            centre += b;
            cn++;
          } else if (Math.abs(c - mid) >= 45) {
            flank += b;
            fn++;
          }
        }
      }
      const cm = centre / cn;
      const fm = flank / fn;
      // pomiar przy dodaniu: z pochodnią 18,7 wobec 13,7; bez pochodni 16,1 wobec 0,0
      expect(cm).toBeGreaterThan(8);
      if (torch) expect(cm / fm).toBeGreaterThan(1.2);
      else expect(fm).toBe(0);
    }
  });
});

describe('wejście jako punkt orientacyjny', () => {
  it('z trzydziestu metrów wlot ma własną sylwetkę', () => {
    // Kontrola: ta sama scena z obrzeżem i bryłami z materiału zwykłego terenu.
    // Różnica między kadrami to dokładnie to, co gracz widzi jako „tam coś jest".
    const s = dungeonScene('approach', { torch: false });
    s.ctx.light.daylight = wildPack.light.daylightDay;
    const withRim = referenceScreen();
    renderWorld(s.store, s.camera, withRim, s.ctx);

    const flat = {
      ...wildPack,
      underground: { ...wildPack.underground, rock: WILD_GROUND, rubble: WILD_GROUND },
    };
    clearDungeonCache();
    const plain = new ChunkStore(WILD_SEED, flat, 3);
    plain.loadRing(s.camera);
    const without = referenceScreen();
    renderWorld(plain, s.camera, without, { ...s.ctx, materials: compileMaterials(flat.materials) });

    let painted = 0;
    let diff = 0;
    for (let i = 0; i < withRim.chars.length; i++) {
      if ((withRim.chars[i] ?? 0) !== 0) painted++;
      if (
        (withRim.chars[i] ?? 0) !== (without.chars[i] ?? 0) ||
        (withRim.colors[i] ?? 0) !== (without.colors[i] ?? 0)
      ) {
        diff++;
      }
    }
    expect(painted).toBeGreaterThan(3000);
    // pomiar przy dodaniu: 2110 komórek, 35% zamalowanego kadru
    expect(diff).toBeGreaterThan(800);
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

  it('materiał przezroczysty jest wyjątkiem, nie regułą', () => {
    // Do M2c ten test pilnował licznika kolumn na masce, bo maska była wolną
    // ścieżką. Teraz ścieżka jest jedna i flaga `transparent` znaczy tylko tyle,
    // że span jest **otworem**: nie maluje się i niczego nie zasłania. Oznaczenie
    // nią wody albo listowia zrobiłoby z nich dziury, przez które widać świat.
    // Dlatego pilnujemy samej listy, a nie kosztu.
    const przezroczyste = wildPack.materials.filter((m) => m.transparent === true).map((m) => m.id);
    expect(przezroczyste).toEqual(['doorway', 'window']);
    expect(neonPack.materials.filter((m) => m.transparent === true)).toEqual([]);
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
