import { describe, it, expect } from 'vitest';
import { wildPack } from '@rpg/content';
import { CHUNK_SIZE, SpanFlags } from './types.js';
import type { Cell, DeltaKey } from './types.js';
import { ChunkStore } from './streaming.js';
import { mulberry32 } from './rng.js';
import {
  parse,
  saveSizeBytes,
  serialize,
  loadFromStorage,
  saveToStorage,
  clearStorage,
  SAVE_VERSION,
} from './save.js';
import type { GameSave, StorageLike } from './save.js';

const SEED = 4242;

function emptySave(): GameSave {
  return {
    version: SAVE_VERSION,
    seed: SEED,
    clock: 0,
    cellDeltas: {},
    flags: {},
    player: {
      x: 10.5,
      y: -20.5,
      z: 4.25,
      yaw: 1.1,
      pitch: -0.03,
      hp: 31,
      maxHp: 45,
      stamina: 62.5,
      maxStamina: 100,
      attrs: [45, 45, 45, 40, 40, 40],
      skills: [28, 10, 15, 16, 10],
      progress: [0.4, 0, 0.25, 0.5, 0],
      weapon: 1,
      armor: 2,
      weaponWear: 12.5,
      armorWear: 3.25,
      items: [
        [0, 0],
        [0, 2],
        [1, 1],
      ],
    },
    entities: [],
  };
}

/**
 * Syntetyczna gra: `hours` godzin, w każdej `perHour` zmian świata. Kopanie tunelu,
 * wyważanie drzwi i zabijanie potworów to jedyne rzeczy, które w tym modelu
 * w ogóle wchodzą do zapisu — reszta wynika z seeda.
 */
function playFor(hours: number, perHour = 60): GameSave {
  const save = emptySave();
  const rnd = mulberry32(SEED ^ 0x5a5a);
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < perHour; i++) {
      const cx = Math.floor(rnd() * 40) - 20;
      const cy = Math.floor(rnd() * 40) - 20;
      const cell = Math.floor(rnd() * CHUNK_SIZE * CHUNK_SIZE);
      const key: DeltaKey = `${cx}:${cy}:${cell}`;
      const spanCount = 1 + Math.floor(rnd() * 2);
      const spans = [];
      let z = Math.round(rnd() * 20) - 4;
      for (let s = 0; s < spanCount; s++) {
        const h0 = z;
        z += 1 + Math.round(rnd() * 3);
        spans.push({ bottom: h0, top: z, mat: 1 + Math.floor(rnd() * 6), capMat: 2, flags: SpanFlags.Solid });
        z += 2;
      }
      save.cellDeltas[key] = { spans, light: Math.floor(rnd() * 16) };
    }
    save.clock += 60;
    if (h % 10 === 0) save.flags[`quest${h}`] = 1;
  }
  for (let i = 0; i < 40; i++) {
    save.entities.push({
      kind: 0,
      x: rnd() * 100,
      y: rnd() * 100,
      z: 4,
      yaw: rnd() * 6.28,
      hp: Math.round(rnd() * 14),
      ai: Math.floor(rnd() * 5),
      origin: i % 2 === 0 ? `3:${i}` : `516557154:${i % 7}`,
    });
  }
  return save;
}

/** `localStorage` na potrzeby testu — kontrakt jest trzyfunkcyjny i to wystarcza. */
function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('format zapisu', () => {
  it('pełny obieg: zapis → tekst → wczytanie daje ten sam stan gracza', () => {
    const save = playFor(4);
    const back = parse(serialize(save));
    expect(back).not.toBeNull();
    expect(back!.player).toEqual(save.player);
    expect(back!.seed).toBe(save.seed);
    expect(back!.clock).toBe(save.clock);
    expect(back!.entities).toEqual(save.entities);
    expect(back!.flags).toEqual(save.flags);
  });

  it('delty komórek wracają co do spanu', () => {
    const save = playFor(6);
    const back = parse(serialize(save))!;
    const klucze = Object.keys(save.cellDeltas) as DeltaKey[];
    expect(klucze.length).toBeGreaterThan(100);
    for (const k of klucze) {
      expect(back.cellDeltas[k]).toEqual(save.cellDeltas[k]);
    }
  });

  it('śmieci na wejściu dają null, a nie wyjątek', () => {
    expect(parse('')).toBeNull();
    expect(parse('{')).toBeNull();
    expect(parse('null')).toBeNull();
    expect(parse('{"v":999}')).toBeNull();
    // zapis w starym formacie jest odrzucany wprost, a nie wczytywany po cichu
    expect(parse(JSON.stringify({ v: 1, seed: 1, clock: 0, d: [], f: [], e: [], p: {} }))).toBeNull();
    expect(parse(JSON.stringify({ v: 1, seed: 1, clock: 0 }))).toBeNull();
  });

  it('uszkodzony klucz delty jest pomijany, reszta zapisu ocalona', () => {
    const save = playFor(1);
    const wire = JSON.parse(serialize(save));
    wire.d.unshift(['nie-jest-kluczem', [null, 3]]);
    wire.d.unshift(['1:2', [null, 3]]);
    const back = parse(JSON.stringify(wire));
    expect(back).not.toBeNull();
    expect(Object.keys(back!.cellDeltas).length).toBe(Object.keys(save.cellDeltas).length);
  });

  it('localStorage: zapis, odczyt, skasowanie', () => {
    const store = fakeStorage();
    const save = playFor(2);
    expect(saveToStorage(store, save)).toBe(true);
    expect(loadFromStorage(store)!.clock).toBe(save.clock);
    clearStorage(store);
    expect(loadFromStorage(store)).toBeNull();
  });
});

describe('budżet zapisu', () => {
  it('200 godzin gry mieści się w 2 MB', () => {
    const save = playFor(200);
    const bytes = saveSizeBytes(save);
    const delt = Object.keys(save.cellDeltas).length;
    console.log(
      `200 h: ${delt} delt, ${(bytes / 1024).toFixed(0)} kB ` +
        `(${(bytes / delt).toFixed(1)} B na deltę)`,
    );
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('format krotkowy jest wyraźnie mniejszy od obiektowego', () => {
    // Powód, dla którego span leży w pliku jako [bottom, top, mat, capMat, flags]:
    // nazwy pól powtórzone przy każdym spanie kosztują więcej niż same liczby.
    const save = playFor(200);
    const krotki = saveSizeBytes(save);
    const obiekty = JSON.stringify({
      v: 1,
      seed: save.seed,
      clock: save.clock,
      d: save.cellDeltas,
      f: save.flags,
      p: save.player,
      e: save.entities,
    }).length;
    console.log(
      `krotki ${(krotki / 1024).toFixed(0)} kB, obiekty ${(obiekty / 1024).toFixed(0)} kB`,
    );
    expect(krotki).toBeLessThan(obiekty * 0.75);
  });
});

describe('świat po wczytaniu', () => {
  it('10 000 komórek zgadza się co do spanu i światła', () => {
    // Zapis nie serializuje świata, więc test musi sprawdzić to, co naprawdę groźne:
    // czy świat odtworzony z seeda plus delty jest identyczny z tym sprzed zapisu.
    const save = playFor(4, 30);

    const przed = new ChunkStore(SEED, wildPack, 1);
    przed.loadRing({ x: 0.5, y: 0.5 });
    przed.applyDeltas(save.cellDeltas);

    const po = new ChunkStore(SEED, wildPack, 1);
    po.loadRing({ x: 0.5, y: 0.5 });
    po.applyDeltas(parse(serialize(save))!.cellDeltas);

    const rnd = mulberry32(7);
    let sprawdzone = 0;
    for (let i = 0; i < 10000; i++) {
      const x = Math.floor(rnd() * 128) - 64;
      const y = Math.floor(rnd() * 128) - 64;
      expect(po.light(x, y)).toBe(przed.light(x, y));
      const n = przed.spanCount(x, y);
      expect(po.spanCount(x, y)).toBe(n);
      for (let s = 0; s < n; s++) {
        expect(po.spanTop(x, y, s)).toBe(przed.spanTop(x, y, s));
        expect(po.spanBottom(x, y, s)).toBe(przed.spanBottom(x, y, s));
        expect(po.spanMaterial(x, y, s)).toBe(przed.spanMaterial(x, y, s));
      }
      sprawdzone++;
    }
    expect(sprawdzone).toBe(10000);
  });

  it('po 200 godzinach gry nadal zgadza się co do komórki', () => {
    const save = playFor(200);

    const przed = new ChunkStore(SEED, wildPack, 1);
    przed.loadRing({ x: 0.5, y: 0.5 });
    przed.applyDeltas(save.cellDeltas);

    const po = new ChunkStore(SEED, wildPack, 1);
    po.loadRing({ x: 0.5, y: 0.5 });
    po.applyDeltas(parse(serialize(save))!.cellDeltas);

    const rnd = mulberry32(11);
    for (let i = 0; i < 10000; i++) {
      const x = Math.floor(rnd() * 128) - 64;
      const y = Math.floor(rnd() * 128) - 64;
      expect(po.light(x, y)).toBe(przed.light(x, y));
      expect(po.spanCount(x, y)).toBe(przed.spanCount(x, y));
    }
  });
});
