import { describe, it, expect } from 'vitest';
import { WILD_SPAWN, wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore } from '@rpg/world';
import { Stance } from '@rpg/rules';
import { Bestiary } from '../../../apps/game/src/entities.js';
import { tryStep } from '../../../apps/game/src/move.js';

const SEED = 4242;
const START_X = 128.5;
const START_Y = -467.5;

/**
 * Marsz po prostej z prędkością biegu, ze strumieniowaniem chunków jak w grze.
 * Zwraca liczbę bytów w pierścieniu życia w zadanych punktach trasy.
 */
function marsz(
  kilometry: readonly number[],
  kierunek = { dx: 1, dy: 0 },
  /** wywoływane raz, w połowie pierwszego odcinka — miejsce na zabicie kogoś po drodze */
  wtracenie?: (b: Bestiary) => boolean,
  /** czy po dojściu do ostatniego punktu wrócić tą samą drogą */
  powrot = false,
) {
  // Pierscien chunkow 1, a nie 3 jak w grze: cykl zycia siega 48 komorek, wiec
  // chunk pod graczem i jego sasiedzi (64 komorki kazdy) w zupelnosci wystarczaja,
  // a generacja chunkow jest tu jedynym powaznym kosztem 30-kilometrowego marszu.
  const world = new ChunkStore(SEED, wildPack, 1);
  world.loadRing({ x: START_X, y: START_Y });
  const b = new Bestiary(SEED, world);
  const wyniki: { km: number; wPierscieniu: number; naLiscie: number }[] = [];

  let x = START_X;
  let y = START_Y;
  // Dwie sekundy biegu na tick. Gra wola `spawnAround` co klatke, ale cykl zycia
  // patrzy na promien 48 komorek (96 m), a tu przesuwamy sie o 8,8 m — dosc gesto,
  // zeby zaden klaster nie przeskoczyl pierscienia niezauwazony.
  const krokKomorek = 8.8 / CELL_METERS;
  let przebyteM = 0;

  for (const cel of kilometry) {
    while (przebyteM < cel * 1000) {
      x += kierunek.dx * krokKomorek;
      y += kierunek.dy * krokKomorek;
      przebyteM += krokKomorek * CELL_METERS;
      while (world.update({ x, y })) {
        /* dociągamy chunki, aż pierścień będzie pełny */
      }
      const z = world.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
      b.spawnAround(x, y, Number.isFinite(z) ? z : 0);
      // probujemy az do skutku: w polowie trasy pierscien bywa akurat pusty
      if (wtracenie !== undefined && przebyteM > (cel * 1000) / 2 && wtracenie(b)) {
        wtracenie = undefined;
      }
    }
    let wPierscieniu = 0;
    for (const m of b.mobs) {
      if (Math.hypot(m.being.x - x, m.being.y - y) <= WILD_SPAWN.liveRadiusCells) wPierscieniu++;
    }
    wyniki.push({ km: cel, wPierscieniu, naLiscie: b.mobs.length });
  }
  // Powrót tą samą drogą: notujemy, kogo świat pokazał na drodze powrotnej. To jest
  // właściwe miejsce na sprawdzenie determinizmu — zwolniony byt musi wrócić ten sam.
  const naPowrocie = new Set<string>();
  if (powrot) {
    while (przebyteM > 0) {
      x -= kierunek.dx * krokKomorek;
      y -= kierunek.dy * krokKomorek;
      przebyteM -= krokKomorek * CELL_METERS;
      while (world.update({ x, y })) {
        /* dociągamy chunki */
      }
      const z = world.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
      b.spawnAround(x, y, Number.isFinite(z) ? z : 0);
      for (const m of b.mobs) naPowrocie.add(m.origin);
    }
  }

  return { wyniki, bestiary: b, pozycja: { x, y }, naPowrocie, world };
}

describe('cykl życia bytów', () => {
  it('po trzydziestu kilometrach świat rodzi tyle samo, co po jednym', () => {
    // Kryterium odbioru M3e. Przed zmianą: 30 bytów po 1,3 km, sufit 64 po 7,9 km
    // i **zero w pierścieniu** na każdym pomiarze — świat przestawał rodzić byty
    // wszędzie i na stałe. Mierzymy z kilku tras, bo jedna trasa może trafić
    // w pas gór albo w jezioro i pokazać zero z powodu terenu, a nie cyklu życia.
    const trasy = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0.7071, dy: -0.7071 },
    ].map((k) => marsz([1, 10, 30], k).wyniki);

    const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    const medianyWPierscieniu: number[] = [];
    for (let i = 0; i < 3; i++) {
      const wPierscieniu = trasy.map((t) => t[i]!.wPierscieniu);
      const naLiscie = trasy.map((t) => t[i]!.naLiscie);
      console.log(
        `${trasy[0]![i]!.km} km: w pierścieniu ${wPierscieniu.join('/')} ` +
          `(mediana ${mediana(wPierscieniu)}), na liście ${naLiscie.join('/')}`,
      );
      medianyWPierscieniu.push(mediana(wPierscieniu));
      // lista nie może rosnąć bez końca: sufit dotyczy okolicy, nie całej partii
      for (const n of naLiscie) expect(n).toBeLessThanOrEqual(WILD_SPAWN.ringCap * 3);
    }

    const srednia = medianyWPierscieniu.reduce((a, c) => a + c, 0) / 3;
    expect(srednia).toBeGreaterThan(0);
    for (const n of medianyWPierscieniu) {
      // rozjazd większy niż ±40% znaczy, że zadanie nie jest zrobione
      expect(Math.abs(n - srednia) / srednia).toBeLessThan(0.4);
    }
  });

  it('ta sama trasa dwa razy daje ten sam świat, trzeci przebieg różni się o jednego zabitego', () => {
    // Zwalnianie i ponowne rodzenie nie może zmieniać zawartości świata: byt
    // nietknięty wraca ten sam, na tej samej pozycji startowej.
    const opis = (m: { mobs: { origin: string; being: { x: number; y: number } }[] }) =>
      m.mobs.map((x) => `${x.origin}@${x.being.x.toFixed(3)},${x.being.y.toFixed(3)}`).sort();

    const a = marsz([2], { dx: 1, dy: 0 }, undefined, true);
    const b = marsz([2], { dx: 1, dy: 0 }, undefined, true);
    expect(opis(a.bestiary).join('|')).toBe(opis(b.bestiary).join('|'));
    expect([...a.naPowrocie].sort().join('|')).toBe([...b.naPowrocie].sort().join('|'));
    expect(a.naPowrocie.size).toBeGreaterThan(0);

    // Trzeci przebieg z jednym zabitym w drodze tam: droga powrotna ma się różnić
    // dokładnie o tego jednego byta, a nie „gdzieś tam mniej więcej".
    const c = marsz(
      [2],
      { dx: 1, dy: 0 },
      (bestiary) => {
        const zywy = bestiary.mobs.find((m) => m.being.actor.stance !== Stance.Dead);
        if (zywy === undefined) return false;
        zywy.being.actor.hp = 0;
        zywy.being.actor.stance = Stance.Dead;
        return true;
      },
      true,
    );
    const zabity = c.bestiary.deltasToSave().filter((d) => d.dead);
    expect(zabity.length).toBe(1);
    const brakujace = [...a.naPowrocie].filter((o) => !c.naPowrocie.has(o));
    console.log(
      `na powrocie: ${a.naPowrocie.size} bytów, po zabiciu jednego ${c.naPowrocie.size}, ` +
        `różnica: ${brakujace.join(',') || 'brak'}`,
    );
    expect(brakujace).toEqual([zabity[0]!.origin]);
  });

  it('zabity zostaje zabity, także po odejściu i powrocie', () => {
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: START_X, y: START_Y });
    const b = new Bestiary(SEED, world);
    const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);
    b.spawnAround(START_X, START_Y, z);
    expect(b.mobs.length).toBeGreaterThan(0);

    const ofiara = b.mobs[0]!;
    const origin = ofiara.origin;
    ofiara.being.actor.hp = 0;
    ofiara.being.actor.stance = Stance.Dead;

    // odchodzimy poza promień zwolnienia i wracamy
    const daleko = START_X + WILD_SPAWN.releaseRadiusCells + 20;
    for (let i = 0; i < 3; i++) b.spawnAround(daleko, START_Y, z);
    expect(b.mobs.some((m) => m.origin === origin)).toBe(false);
    expect(b.deltasToSave().some((d) => d.origin === origin && d.dead)).toBe(true);

    for (let i = 0; i < 3; i++) b.spawnAround(START_X, START_Y, z);
    expect(b.mobs.some((m) => m.origin === origin)).toBe(false);
  });

  it('ranny wraca ranny, nietknięty nie zostawia śladu w zapisie', () => {
    const world = new ChunkStore(SEED, wildPack, 3);
    world.loadRing({ x: START_X, y: START_Y });
    const b = new Bestiary(SEED, world);
    const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);
    b.spawnAround(START_X, START_Y, z);
    const ile = b.mobs.length;
    expect(ile).toBeGreaterThan(0);

    const ranny = b.mobs[0]!;
    const origin = ranny.origin;
    ranny.being.actor.hp = 5;

    const daleko = START_X + WILD_SPAWN.releaseRadiusCells + 20;
    for (let i = 0; i < 3; i++) b.spawnAround(daleko, START_Y, z);
    // delta powstaje **tylko** dla zmienionego bytu, reszta znika bez śladu
    expect(b.deltasToSave().length).toBe(1);
    expect(b.deltasToSave()[0]!.origin).toBe(origin);

    for (let i = 0; i < 3; i++) b.spawnAround(START_X, START_Y, z);
    const wrocil = b.mobs.find((m) => m.origin === origin);
    expect(wrocil).toBeDefined();
    expect(wrocil!.being.actor.hp).toBe(5);
    expect(b.mobs.length).toBe(ile);
  });

  it('byty nie lądują na niedostępnych półkach', () => {
    // Zdjęcie pułapu `pz + 3` znaczy, że grunt czytamy z komórki kandydata, a nie
    // względem gracza. Trzeba było sprawdzić, czy przez to ktoś nie staje na iglicy,
    // z której nie ma zejścia — bo taki byt to widoczny błąd, a nie zamieszkanie.
    const cialo = { heightM: 1.6, stepUpM: 0.6, wadeM: 1 };
    let zbadanych = 0;
    let odciętych = 0;
    for (const kierunek of [
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0.7, dy: -0.7 },
    ]) {
      const { bestiary, world } = marsz([3], kierunek);
      for (const m of bestiary.mobs) {
        zbadanych++;
        const b = m.being;
        const wyjscia = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dy]) => tryStep(world, b.z, b.x + dx!, b.y + dy!, cialo) !== null);
        if (wyjscia.length === 0) odciętych++;
      }
    }
    const udzial = odciętych / zbadanych;
    console.log(`byty bez wyjścia z komórki: ${odciętych} z ${zbadanych} (${(udzial * 100).toFixed(1)}%)`);
    expect(zbadanych).toBeGreaterThan(20);
    expect(udzial).toBeLessThan(0.1);
  });

  it('wczytanie zapisu nie mnoży bytów ani nie wskrzesza zabitych', () => {
    const world = new ChunkStore(SEED, wildPack, 1);
    world.loadRing({ x: START_X, y: START_Y });
    const b = new Bestiary(SEED, world);
    const z = world.surfaceHeight(Math.floor(START_X), Math.floor(START_Y), 1e6);
    b.spawnAround(START_X, START_Y, z);

    // jeden zabity na miejscu, jeden zabity i zostawiony za plecami
    const zabity = b.mobs[0]!;
    zabity.being.actor.hp = 0;
    zabity.being.actor.stance = Stance.Dead;
    const daleko = START_X + WILD_SPAWN.releaseRadiusCells + 20;
    b.spawnAround(daleko, START_Y, z);
    b.spawnAround(START_X, START_Y, z);

    const zapisane = b.toSave();
    const delty = b.deltasToSave();
    const ile = b.mobs.length;

    const po = new Bestiary(SEED, world);
    po.restore(zapisane, delty);
    po.spawnAround(START_X, START_Y, z);
    expect(po.mobs.length).toBe(ile);
    expect(po.mobs.filter((m) => m.origin === zabity.origin).length).toBeLessThanOrEqual(1);
    for (const m of po.mobs) {
      if (m.origin === zabity.origin) expect(m.being.actor.stance).toBe(Stance.Dead);
    }
  });

  it('sufit dotyczy pierścienia, a nie całej partii', () => {
    // Po dobiciu do sufitu świat ma nadal rodzić byty gdzie indziej — to jest
    // różnica między „tłok w okolicy" a „koniec rozmnażania".
    const { bestiary, pozycja } = marsz([12]);
    let wPierscieniu = 0;
    for (const m of bestiary.mobs) {
      if (Math.hypot(m.being.x - pozycja.x, m.being.y - pozycja.y) <= WILD_SPAWN.liveRadiusCells) {
        wPierscieniu++;
      }
    }
    expect(wPierscieniu).toBeLessThanOrEqual(WILD_SPAWN.ringCap);
  });
});
