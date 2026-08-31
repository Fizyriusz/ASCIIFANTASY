import { describe, it, expect } from 'vitest';
import { createLightRig } from '@rpg/core';
import { WILD_SPAWN, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, dungeonDwellers, dungeonsNear, h32 } from '@rpg/world';
import type { DungeonGraph } from '@rpg/world';
import { Bestiary } from '../../../apps/game/src/entities.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;

/** Loch, do którego skacze klawisz `G` w grze — ten sam wybór, ta sama scena. */
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

function store(x: number, y: number): ChunkStore {
  const s = new ChunkStore(SEED, wildPack, 3);
  s.loadRing({ x, y });
  return s;
}

describe('zaludnienie lochu w grze', () => {
  it('komora lochu dostaje mieszkańców, a nie łąka nad nią', () => {
    // To jest test na trzy przyczyny naraz, opisane w zleceniu M3d: klaster
    // przegrywający losowanie, pozycję losowaną z całego klastra i klastry
    // zużywane na powierzchni. Przed M3d ten test dawał zero.
    const g = najblizszyLoch();
    const pokoj = g.rooms[g.rooms.length - 1] ?? g.rooms[0]!;
    const px = pokoj.x + pokoj.w / 2;
    const py = pokoj.y + pokoj.h / 2;
    const w = store(px, py);
    const b = new Bestiary(SEED, w);

    b.spawnAround(px, py, pokoj.floorZ);
    expect(b.mobs.length).toBeGreaterThan(0);

    // Każdy stoi na podłodze którejś komory tego lochu, a nie na terenie nad nim.
    // Zawartość liczy się dla całego lochu naraz, więc byty są na różnych
    // kondygnacjach — porównanie z podłogą jednej komory byłoby błędem testu.
    const podlogi = g.rooms.map((r) => r.floorZ);
    for (const m of b.mobs) {
      expect(m.origin).toMatch(/^\d+:\d+$/);
      expect(podlogi.some((z) => Math.abs(z - m.being.z) < 1.5)).toBe(true);
    }
  });

  it('nikt nie stoi w skale', () => {
    const g = najblizszyLoch();
    const w = store(g.mouthX, g.mouthY);
    for (const d of dungeonDwellers(SEED, g)) {
      const z = w.surfaceHeight(Math.floor(d.x), Math.floor(d.y), d.z + 2);
      if (!Number.isFinite(z)) continue; // odrzucone przez warstwę gry
      expect(w.blocks(Math.floor(d.x), Math.floor(d.y), z + 0.1, z + 1.6)).toBe(false);
    }
  });

  it('żagwie trafiają do zestawu świateł i nie przekraczają jego limitu', () => {
    const g = najblizszyLoch();
    const pokoj = g.rooms[g.rooms.length - 1] ?? g.rooms[0]!;
    const px = pokoj.x + pokoj.w / 2;
    const py = pokoj.y + pokoj.h / 2;
    const b = new Bestiary(SEED, store(px, py));
    b.spawnAround(px, py, pokoj.floorZ);

    const rig = createLightRig();
    const n = b.feedLights(rig, px, py);
    expect(n).toBe(rig.count);
    // Limit jest cichy: addSource zwraca false i loch gaśnie w połowie bez słowa.
    expect(rig.count).toBeLessThanOrEqual(rig.max);

    // ...a na powierzchni żagwi nie ma wcale
    const naPowierzchni = new Bestiary(SEED, store(START_X, START_Y));
    const zPowierzchni = naPowierzchni.feedLights(rig, START_X, START_Y);
    expect(zPowierzchni).toBe(0);
    expect(rig.count).toBe(0);
  });

  it('stojąc nad lochem gracz nie zużywa jego komór', () => {
    // Klastry powierzchni i komory lochu to dwa rozłączne zbiory pochodzeń.
    const g = najblizszyLoch();
    const pokoj = g.rooms[g.rooms.length - 1] ?? g.rooms[0]!;
    const px = pokoj.x + pokoj.w / 2;
    const py = pokoj.y + pokoj.h / 2;
    const w = store(px, py);
    const naGorze = w.surfaceHeight(Math.floor(px), Math.floor(py), 1e6);

    const b = new Bestiary(SEED, w);
    b.spawnAround(px, py, naGorze); // gracz na łące nad komorą
    const naPowierzchni = b.mobs.length;
    b.spawnAround(px, py, pokoj.floorZ); // ...i po zejściu do niej
    const razem = b.mobs.length;

    expect(razem).toBeGreaterThan(naPowierzchni);
    const wLochu = b.mobs.filter((m) => m.origin.includes(`${g.poiId}:`)).length;
    expect(wLochu).toBeGreaterThan(0);
  });
});

describe('pomiar: czy powierzchnia się wyludnia', () => {
  it('liczba bytów w pierścieniu po 5, 30 i 120 minutach marszu', () => {
    // Zlecenie M3d §5: mierzymy i opisujemy, NIE naprawiamy tutaj. Model marszu:
    // gracz idzie po prostej z prędkością biegu, a co sekundę wołane jest to samo
    // `spawnAround`, co w grze. Liczymy osobno byty w pierścieniu wokół gracza
    // (to jest „czy świat wokół mnie żyje") i całą listę.
    const w = store(START_X, START_Y);
    const b = new Bestiary(SEED, w);
    const kroki: string[] = [];
    let x = START_X;
    const y = START_Y;
    let minuty = 0;
    const RUN_CELLS_PER_S = 4.4 / CELL_METERS;

    for (const cel of [5, 30, 120]) {
      while (minuty < cel) {
        x += RUN_CELLS_PER_S;
        // strumieniowanie chunków jak w grze — bez tego marsz wychodzi poza
        // załadowany pierścień i `surfaceHeight` zwraca -Infinity dla wszystkiego,
        // co dawałoby fałszywy obraz wyludnienia
        while (w.update({ x, y })) {
          /* dociągamy chunki, aż pierścień będzie pełny */
        }
        const z = w.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
        b.spawnAround(x, y, Number.isFinite(z) ? z : 0);
        minuty += 1 / 60;
      }
      let wPierscieniu = 0;
      for (const m of b.mobs) {
        if (Math.hypot(m.being.x - x, m.being.y - y) < 48) wPierscieniu++;
      }
      kroki.push(
        `${cel} min (${((x - START_X) * CELL_METERS / 1000).toFixed(1)} km): ` +
          `w pierścieniu 48 komórek ${wPierscieniu}, w całej liście ${b.mobs.length}`,
      );
    }
    for (const k of kroki) console.log(k);
    expect(kroki.length).toBe(3);
  });

  it('dlaczego: ile klastrów odrzuca warunek gruntu pod pułapem gracza', () => {
    // Diagnoza do raportu. `spawnCluster` szuka gruntu pod pułapem `pz + 3`, gdzie
    // `pz` to wysokość gracza. Kandydat leżący na wzgórzu wyżej niż trzy metry nad
    // graczem nie ma pod tym pułapem żadnej czapki i wypada — a ponieważ klaster
    // zostaje oznaczony jako rozpatrzony, nie wróci już nigdy.
    const w = store(START_X, START_Y);
    let zamieszkanych = 0;
    let brakGruntu = 0;
    let ok = 0;
    const pz = w.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);

    for (let ky = -3; ky <= 3; ky++) {
      for (let kx = -3; kx <= 3; kx++) {
        const cx = Math.floor(START_X / 16) + kx;
        const cy = Math.floor(START_Y / 16) + ky;
        const h = h32(SEED ^ 0x60b1, cx, cy, 0) >>> 0;
        if (h % WILD_SPAWN.oneInClusters !== 0) continue;
        zamieszkanych++;
        const rozp = WILD_SPAWN.packMax - WILD_SPAWN.packMin + 1;
        const ilu = WILD_SPAWN.packMin + ((h >>> 8) % rozp);
        for (let n = 0; n < ilu; n++) {
          const hp = h32(h, n, 0, 0) >>> 0;
          const x = cx * 16 + (hp % 16) + 0.5;
          const y = cy * 16 + ((hp >>> 8) % 16) + 0.5;
          const z = w.surfaceHeight(Math.floor(x), Math.floor(y), pz + 3);
          if (!Number.isFinite(z)) brakGruntu++;
          else ok++;
        }
      }
    }
    console.log(
      `pierścień startowy: klastrów zamieszkanych ${zamieszkanych}, kandydatów ` +
        `${brakGruntu + ok}, odrzuconych brakiem gruntu pod pułapem ${brakGruntu}, ` +
        `wystawionych ${ok}`,
    );
    expect(zamieszkanych).toBeGreaterThan(0);
  });
});
