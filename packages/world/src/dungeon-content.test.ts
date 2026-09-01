import { describe, it, expect } from 'vitest';
import { DUNGEON_LIGHT, DUNGEON_SPAWN } from '@rpg/content';
import { CELL_METERS } from './types.js';
import { dungeonDwellers, dungeonLights, dungeonsNear } from './dungeon.js';
import type { DungeonGraph } from './dungeon.js';

const SEED = 4242;

/** Pięćdziesiąt lochów z jednego seeda — próbka, na której liczymy rozkłady. */
function lochy(ile = 50): DungeonGraph[] {
  const out: DungeonGraph[] = [];
  for (let i = 0; out.length < ile && i < 40; i++) {
    const x = i * 2048;
    for (const g of dungeonsNear(SEED, x, -4096, x + 2048, 4096)) {
      out.push(g);
      if (out.length >= ile) break;
    }
  }
  return out;
}

describe('zawartość lochu', () => {
  it('jest czystą funkcją seeda i grafu', () => {
    const g = lochy(1)[0];
    expect(g).toBeDefined();
    const wzorzec = JSON.stringify(dungeonDwellers(SEED, g!, DUNGEON_SPAWN));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(dungeonDwellers(SEED, g!, DUNGEON_SPAWN))).toBe(wzorzec);
    }
    // inny seed to inna obsada — inaczej „deterministyczne" znaczyłoby „stałe"
    expect(JSON.stringify(dungeonDwellers(SEED + 1, g!, DUNGEON_SPAWN))).not.toBe(wzorzec);
  });

  it('światła mają własny strumień losowy, niezależny od mieszkańców', () => {
    // Dwa pokrętła w contencie mają być naprawdę niezależne: zmiana liczebności
    // potworów nie może przestawiać żagwi.
    const g = lochy(1)[0]!;
    const a = JSON.stringify(dungeonLights(SEED, g, DUNGEON_LIGHT));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(dungeonLights(SEED, g, DUNGEON_LIGHT))).toBe(a);
    expect(a).not.toBe(JSON.stringify(dungeonDwellers(SEED, g, DUNGEON_SPAWN)));
  });

  it('pusty loch jest rzadkością, nie regułą', () => {
    const próbka = lochy();
    expect(próbka.length).toBeGreaterThan(20);
    const liczby = próbka.map((g) => dungeonDwellers(SEED, g, DUNGEON_SPAWN).length).sort((a, b) => a - b);
    const puste = liczby.filter((n) => n === 0).length;
    const mediana = liczby[liczby.length >> 1] ?? 0;
    console.log(
      `mieszkańcy: mediana ${mediana} na loch, pustych ${puste}/${próbka.length}, ` +
        `zakres ${liczby[0]}–${liczby[liczby.length - 1]}`,
    );
    // Pusty loch był stanem domyślnym przed M3d i to jest cały powód tego zadania.
    expect(puste / próbka.length).toBeLessThan(0.05);
    expect(mediana).toBeGreaterThan(2);
  });

  it('żagwie są wyjątkiem, a nie oświetleniem lochu', () => {
    const próbka = lochy();
    let komór = 0;
    let zŻagwią = 0;
    const naLoch: number[] = [];
    for (const g of próbka) {
      const l = dungeonLights(SEED, g, DUNGEON_LIGHT);
      naLoch.push(l.length);
      komór += g.rooms.length;
      zŻagwią += new Set(l.map((x) => x.roomIndex)).size;
    }
    naLoch.sort((a, b) => a - b);
    console.log(
      `żagwie: mediana ${naLoch[naLoch.length >> 1]} na loch, ` +
        `komór z żagwią ${((zŻagwią / komór) * 100).toFixed(0)}%, ` +
        `maks ${naLoch[naLoch.length - 1]} w jednym lochu`,
    );
    // Ciemność jest stanem domyślnym: oświetlona ma być mniejszość komór.
    expect(zŻagwią / komór).toBeLessThan(0.5);
    expect(zŻagwią / komór).toBeGreaterThan(0.1);
  });

  it('każdy mieszkaniec stoi we wnętrzu swojej komory, na jej podłodze', () => {
    for (const g of lochy()) {
      for (const d of dungeonDwellers(SEED, g, DUNGEON_SPAWN)) {
        const r = g.rooms[d.roomIndex];
        expect(r).toBeDefined();
        expect(d.x).toBeGreaterThan(r!.x);
        expect(d.x).toBeLessThan(r!.x + r!.w);
        expect(d.y).toBeGreaterThan(r!.y);
        expect(d.y).toBeLessThan(r!.y + r!.h);
        expect(d.z).toBe(r!.floorZ);
      }
    }
  });

  it('żagiew wisi pod stropem, a nie w nim', () => {
    for (const g of lochy()) {
      for (const l of dungeonLights(SEED, g, DUNGEON_LIGHT)) {
        const r = g.rooms[l.roomIndex]!;
        expect(l.z).toBeGreaterThan(r.floorZ);
        expect(l.z).toBeLessThan(r.ceilZ);
        expect(l.z).toBeLessThanOrEqual(r.floorZ + DUNGEON_LIGHT.heightM);
        // pozycja żagwi jest w metrach, bo tak ją bierze LightRig
        expect(Math.abs(l.x / CELL_METERS - Math.round(l.x / CELL_METERS - 0.5) - 0.5)).toBeLessThan(1e-6);
      }
    }
  });

  it('komora z wejściem jest zamieszkana rzadziej niż reszta', () => {
    // Pierwsze trzy kroki w lochu nie mają być walką.
    let wejsciowychZamieszkanych = 0;
    let wejsciowych = 0;
    let innychZamieszkanych = 0;
    let innych = 0;
    for (const g of lochy()) {
      const zajete = new Set(dungeonDwellers(SEED, g, DUNGEON_SPAWN).map((d) => d.roomIndex));
      for (let i = 0; i < g.rooms.length; i++) {
        if (i === g.entrance) {
          wejsciowych++;
          if (zajete.has(i)) wejsciowychZamieszkanych++;
        } else {
          innych++;
          if (zajete.has(i)) innychZamieszkanych++;
        }
      }
    }
    const wejscie = wejsciowychZamieszkanych / Math.max(1, wejsciowych);
    const reszta = innychZamieszkanych / Math.max(1, innych);
    console.log(`komora wejściowa zamieszkana w ${(wejscie * 100).toFixed(0)}%, pozostałe ${(reszta * 100).toFixed(0)}%`);
    expect(wejscie).toBeLessThan(reszta);
  });
});
