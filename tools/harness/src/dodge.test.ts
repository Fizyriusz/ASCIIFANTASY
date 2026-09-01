import { describe, it, expect } from 'vitest';
import { COMBAT, PLAYER, Weapon, weapons, wildCreatures, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, dungeonsNear } from '@rpg/world';
import type { DungeonGraph } from '@rpg/world';
import { Stance, beginDodge, equipWeapon, makeActor, reachOf, makeBeing, tickActor } from '@rpg/rules';
import { dodgeSpeed, tryStep } from '../../../apps/game/src/move.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;
const DT = 16;
const CIALO = { heightM: 1.85, stepUpM: 0.6, wadeM: 1 };

/**
 * Unik przeprowadzony **tą samą drogą, którą chodzi gra**: `dodgeSpeed` na profil
 * prędkości i `tryStep` na kolizję, osobno w X i Y. Zwraca przebytą odległość
 * w metrach.
 */
function unik(
  world: ChunkStore,
  start: { x: number; y: number; z: number },
  dir: { dx: number; dy: number },
): { x: number; y: number; dystansM: number } {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  expect(beginDodge(a)).toBe(true);
  let x = start.x;
  let y = start.y;
  let feet = start.z;
  // własny licznik przesunięcia, dokładnie jak w grze: `actor.dodgeMs` mierzy okno
  // nietykalności, a ruch ma swój czas
  let ruchMs = COMBAT.dodgeMoveMs;

  while (ruchMs > 0) {
    const v = dodgeSpeed(ruchMs, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM) / CELL_METERS;
    const dt = DT / 1000;
    const kx = tryStep(world, feet, x + dir.dx * v * dt, y, CIALO);
    if (kx !== null) {
      x = kx.x;
      feet = kx.surfZ;
    }
    const ky = tryStep(world, feet, x, y + dir.dy * v * dt, CIALO);
    if (ky !== null) {
      y = ky.y;
      feet = ky.surfZ;
    }
    tickActor(a, DT);
    ruchMs -= DT;
  }
  return { x, y, dystansM: Math.hypot(x - start.x, y - start.y) * CELL_METERS };
}

/** Zasięg rozstrzygania ciosu dla danej broni — ta sama definicja, której używa walka. */
function zasieg(bron: number): number {
  const a = makeActor(20, 60, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, bron);
  return reachOf(makeBeing(a, 0, 0, 0, 0, -1, 1, 1));
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

describe('unik jest ruchem, nie znaczkiem', () => {
  it('przesuwa gracza o zadany dystans i w zadanym kierunku', () => {
    // Sygnałem uniku ma być to, że świat jedzie w drugą stronę — więc dystans
    // jest daną z contentu, a nie wypadkową kroku czasowego.
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: START_X, y: START_Y });
    const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);

    for (const dir of [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ]) {
      const r = unik(world, { x: START_X, y: START_Y, z }, dir);
      expect(r.dystansM).toBeGreaterThan(COMBAT.dodgeDistanceM * 0.8);
      expect(r.dystansM).toBeLessThan(COMBAT.dodgeDistanceM * 1.2);
      // ...i dokładnie w tę stronę, w którą prosiliśmy
      if (dir.dx !== 0) expect(Math.sign(r.x - START_X)).toBe(Math.sign(dir.dx));
      if (dir.dy !== 0) expect(Math.sign(r.y - START_Y)).toBe(Math.sign(dir.dy));
    }
  });

  it('wyprowadza poza zasięg typowej broni', () => {
    // Dystans uniku jest **wyprowadzony z zasięgu**, nie z gustu: ma wyjść poza
    // rozstrzyganie ciosu maczugi (2,0 m) i sztyletu (1,7 m), licząc od dystansu,
    // na którym trzyma się AI w zwarciu (1,8 m).
    const zasiegMaczugi = zasieg(wildCreatures[0]!.weapon!);
    const zasiegSztyletu = zasieg(Weapon.Dagger);
    const dystansPoUniku = 1.8 + COMBAT.dodgeDistanceM;

    expect(dystansPoUniku).toBeGreaterThan(zasiegMaczugi * 1.5);
    expect(dystansPoUniku).toBeGreaterThan(zasiegSztyletu * 1.5);
    // ...ale nie tak daleko, żeby unik zamieniał się w ucieczkę
    expect(COMBAT.dodgeDistanceM).toBeLessThan(zasiegMaczugi * 1.5);
  });

  it('szarpnięcie mieści się w tempie, które da się odczytać', () => {
    // Przy 2,2 m i oknie 260 ms szczyt wychodził 16,9 m/s i 27 cm przeskoku na
    // klatkę — to czyta się jak teleport, nie uskok. Okno jest po to, żeby ten sam
    // dystans rozłożyć na czas; profil zostaje malejący.
    const szczyt = dodgeSpeed(COMBAT.dodgeMoveMs, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM);
    const krokNaKlatke = (szczyt * 16) / 1000;
    expect(szczyt).toBeGreaterThan(4.4); // szybciej niż bieg, inaczej to nie unik
    expect(szczyt).toBeLessThan(11); // ale nie tak, żeby świat przeskakiwał
    expect(krokNaKlatke).toBeLessThan(0.2);
  });

  it('unik w ścianę nie przesuwa i nie przenika', () => {
    // Przesunięcie „bo to tylko efekt" jest najprostszym sposobem na wyjście gracza
    // za geometrię. Ta sama kolizja co przy kroku znaczy: w ścianę się nie da.
    const g = najblizszyLoch();
    let komora = g.rooms[0]!;
    for (const r of g.rooms) if (r.level > komora.level) komora = r;
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: komora.x + komora.w / 2, y: komora.y + komora.h / 2 });

    // Ściany szukamy pomiarem, a nie z obrysu komory: krawędź prostokąta nie musi
    // być litą skałą — po drugiej stronie bywa korytarz.
    const y = komora.y + Math.floor(komora.h / 2);
    const z = komora.floorZ;
    let sciana = komora.x - 1;
    for (let x = komora.x - 1; x < komora.x + komora.w; x++) {
      if (world.blocks(x, y, z + 0.1, z + CIALO.heightM)) sciana = x;
      else break;
    }
    // stajemy tuż obok niej, twarzą do skały
    const x = sciana + 1.05;
    expect(world.blocks(sciana, y, z + 0.1, z + CIALO.heightM)).toBe(true);

    const r = unik(world, { x, y: y + 0.5, z }, { dx: -1, dy: 0 });

    expect(r.dystansM).toBeLessThan(0.3);
    // i nadal stoimy w komorze, a nie w litej skale
    expect(world.blocks(Math.floor(r.x), Math.floor(r.y), z + 0.1, z + CIALO.heightM)).toBe(false);
  });

  it('w wąskim korytarzu unik też zatrzymuje się na ścianie', () => {
    // Komora ma zapas miejsca, korytarz nie ma go wcale — a przy dystansie
    // przekraczającym szerokość przejścia to właśnie tu najłatwiej wyjść za geometrię.
    const g = najblizszyLoch();
    const world = new ChunkStore(SEED, wildPack, 3);
    const kor = g.corridors.find((c) => !c.stairs) ?? g.corridors[0]!;
    const sx = Math.round((kor.x0 + kor.x1) / 2);
    const sy = Math.round((kor.y0 + kor.y1) / 2);
    world.loadRing({ x: sx, y: sy });
    const z = kor.floorZ;

    // szerokość przejścia w poprzek: liczymy wolne komórki w obie strony
    let wolneX = 0;
    for (let d = -3; d <= 3; d++) {
      if (!world.blocks(sx + d, sy, z + 0.1, z + CIALO.heightM)) wolneX++;
    }
    let wolneY = 0;
    for (let d = -3; d <= 3; d++) {
      if (!world.blocks(sx, sy + d, z + 0.1, z + CIALO.heightM)) wolneY++;
    }
    // unik robimy w poprzek korytarza, czyli w tę oś, która jest węższa
    const wPoprzek = wolneX <= wolneY ? { dx: -1, dy: 0 } : { dx: 0, dy: -1 };
    console.log(
      `korytarz (${sx}, ${sy}): wolnych komórek w osi X ${wolneX}, w osi Y ${wolneY} ` +
        `(komórka to ${CELL_METERS} m, więc przejście ma ${Math.min(wolneX, wolneY) * CELL_METERS} m szerokości)`,
    );
    expect(Math.min(wolneX, wolneY)).toBeLessThan(7); // to naprawdę jest przejście

    // Stajemy **przy samej ścianie** korytarza i uskakujemy w nią. Środek przejścia
    // nie jest testem: komórka ma dwa metry, więc trzykomórkowy korytarz ma sześć
    // metrów szerokości i unik mieści się w nim w całości — co samo w sobie jest
    // dobrą wiadomością i dlatego jest w logu powyżej.
    let x = sx + 0.5;
    let y = sy + 0.5;
    while (!world.blocks(Math.floor(x + wPoprzek.dx), Math.floor(y + wPoprzek.dy), z + 0.1, z + CIALO.heightM)) {
      x += wPoprzek.dx;
      y += wPoprzek.dy;
    }
    // ...i to przy samej jej krawędzi, nie na środku ostatniej wolnej komórki:
    // kolizja jest komórkowa, więc ze środka komórki zostaje jeszcze metr luzu
    if (wPoprzek.dx !== 0) x = Math.floor(x) + 0.05;
    else y = Math.floor(y) + 0.05;

    const r = unik(world, { x, y, z }, wPoprzek);
    // ściana zatrzymuje unik niemal od razu...
    expect(r.dystansM).toBeLessThan(0.3);
    // ...i nie zostawia gracza w skale
    expect(world.blocks(Math.floor(r.x), Math.floor(r.y), z + 0.1, z + CIALO.heightM)).toBe(false);
  });

  it('czas ruchu i czas nietykalności to dwa osobne regulatory', () => {
    // Rozdzielone, choć dziś mają tę samą wartość: okno nietykalności zmienia tempo
    // walki (mediana 10 000 starć poszła z 5,2 na 6,5 s przy jego wydłużeniu),
    // a czas ruchu zmienia wyłącznie to, jak unik wygląda.
    expect(COMBAT.dodgeMoveMs).toBeGreaterThan(0);
    expect(COMBAT.dodgeWindowMs).toBeGreaterThan(0);
    // skrócenie samego ruchu podnosi szczyt prędkości i nie rusza obrony
    const szybciej = dodgeSpeed(200, 200, COMBAT.dodgeDistanceM);
    const wolniej = dodgeSpeed(600, 600, COMBAT.dodgeDistanceM);
    expect(szybciej).toBeGreaterThan(wolniej);
  });

  it('kilka uników z rzędu wyczerpuje pulę, bo unik jest wart więcej niż cios', () => {
    // Unik wyprowadzający z walki ma kosztować więcej niż zamach: przy sztylecie
    // (7% puli) i mieczu (13%) unik to 24%, czyli cztery uniki na pełnym pasku.
    const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
    let uniki = 0;
    while (beginDodge(a)) {
      uniki++;
      a.stance = Stance.Idle; // pomijamy odbicie: liczymy sam koszt wytrzymałości
      a.dodgeMs = 0;
    }
    console.log(
      `uników z pełnej puli: ${uniki} (koszt ${((COMBAT.dodgeStamina / PLAYER.stamina) * 100).toFixed(0)}% puli, ` +
        `cios mieczem ${((weapons[Weapon.Shortsword]!.stamina / PLAYER.stamina) * 100).toFixed(0)}%)`,
    );
    expect(uniki).toBeGreaterThanOrEqual(3);
    expect(uniki).toBeLessThanOrEqual(5);
    expect(COMBAT.dodgeStamina).toBeGreaterThan(weapons[Weapon.Shortsword]!.stamina);
  });

  it('profil prędkości daje zadany dystans, niezależnie od kroku czasowego', () => {
    // Całka po oknie ma dać dokładnie `dodgeDistanceM` — inaczej dystans zależałby
    // od liczby klatek, czyli od maszyny gracza.
    for (const krok of [8, 16, 33]) {
      let s = 0;
      for (let pozostalo = COMBAT.dodgeMoveMs; pozostalo > 0; pozostalo -= krok) {
        s += (dodgeSpeed(pozostalo, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM) * krok) / 1000;
      }
      expect(s).toBeGreaterThan(COMBAT.dodgeDistanceM * 0.85);
      expect(s).toBeLessThan(COMBAT.dodgeDistanceM * 1.15);
    }
  });

  it('unik zaczyna się szarpnięciem, a kończy wyhamowaniem', () => {
    const start = dodgeSpeed(COMBAT.dodgeMoveMs, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM);
    const polowa = dodgeSpeed(COMBAT.dodgeMoveMs / 2, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM);
    const koniec = dodgeSpeed(0, COMBAT.dodgeMoveMs, COMBAT.dodgeDistanceM);
    expect(start).toBeGreaterThan(polowa);
    expect(polowa).toBeGreaterThan(koniec);
    // szarpnięcie ma być wyraźnie szybsze od biegu, inaczej nie czyta się jako unik
    expect(start).toBeGreaterThan(4.4);
  });
});
