import { describe, it, expect } from 'vitest';
import { PERCEPTION, PLAYER, wildCreatures } from '@rpg/content';
import { SpanGrid, SpanFlags, mulberry32 } from '@rpg/world';
import { makeActor, Stance } from './actor.js';
import { AiState, makeBeing } from './being.js';
import type { Being } from './being.js';
import { canHear, canSee, cellLight, hasLineOfSight } from './perception.js';
import { makeIntent, updateAi } from './ai.js';
import type { Intent } from './ai.js';

const MPC = 2; // metry na komórkę — jak w grze

/**
 * Płaska hala 40×40 z podłogą na wysokości 0 i zadanym światłem. Osobna, prosta
 * scena zamiast generatora: test percepcji ma sprawdzać percepcję, a nie to,
 * co akurat wygenerował loch.
 */
const HALL = 64; // SpanGrid wymaga potęgi dwójki

function hall(light = 15): SpanGrid {
  const g = new SpanGrid(HALL, HALL);
  for (let y = 0; y < HALL; y++) {
    for (let x = 0; x < HALL; x++) {
      g.setColumn(x, y, [{ bottom: -4, top: 0, mat: 1, capMat: 1, flags: SpanFlags.Solid }]);
      g.setLight(x, y, light); // SpanGrid trzyma światło jako czystą wartość 0..15
    }
  }
  return g;
}

/** Mur w poprzek hali na osi x = 20, od podłogi po sufit. */
function addWall(g: SpanGrid): void {
  for (let y = 0; y < HALL; y++) {
    g.setColumn(20, y, [{ bottom: -4, top: 6, mat: 1, capMat: 1, flags: SpanFlags.Solid }]);
  }
}

function player(x: number, y: number, yaw = 0, lum = 1): Being {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  const b = makeBeing(a, x, y, 0, yaw, -1, 1.9, 4.4);
  b.lum = lum;
  return b;
}

function goblin(x: number, y: number, yaw = 0): Being {
  const def = wildCreatures[0]!;
  const a = makeActor(def.hp, 60, def.attrs, def.skills);
  a.weapon = def.weapon;
  return makeBeing(a, x, y, 0, yaw, 0, def.walkMps, def.runMps);
}

describe('stożek widzenia', () => {
  it('widzi przed sobą, nie widzi za plecami', () => {
    const g = hall();
    const g1 = goblin(10, 10, 0);
    expect(canSee(g1, player(15, 10), g, MPC)).toBe(true);
    expect(canSee(g1, player(5, 10), g, MPC)).toBe(false);
  });

  it('za plecami, ale tuż obok — czuje mimo wszystko', () => {
    const g = hall();
    const g1 = goblin(10, 10, 0);
    // pół komórki za plecami to metr: w zasięgu `senseM`
    expect(canSee(g1, player(9.5, 10), g, MPC)).toBe(true);
  });

  it('granica stożka jest tam, gdzie mówi content', () => {
    const g = hall();
    const g1 = goblin(10, 10, 0);
    const d = 8;
    const tuzWewnatrz = PERCEPTION.coneHalf - 0.05;
    const tuzNaZewnatrz = PERCEPTION.coneHalf + 0.05;
    expect(
      canSee(g1, player(10 + Math.cos(tuzWewnatrz) * d, 10 + Math.sin(tuzWewnatrz) * d), g, MPC),
    ).toBe(true);
    expect(
      canSee(g1, player(10 + Math.cos(tuzNaZewnatrz) * d, 10 + Math.sin(tuzNaZewnatrz) * d), g, MPC),
    ).toBe(false);
  });
});

describe('światło i skradanie', () => {
  it('nieoświetlony cel jest niewidoczny mimo czystej linii wzroku', () => {
    const g = hall(15);
    const obserwator = goblin(10, 10, 0);
    expect(canSee(obserwator, player(18, 10, 0, 1), g, MPC)).toBe(true);
    expect(canSee(obserwator, player(18, 10, 0, 0), g, MPC)).toBe(false);
    // ...ale z bliska i tak go wyczuje, po oddechu
    expect(canSee(obserwator, player(10.8, 10, 0, 0), g, MPC)).toBe(true);
  });

  it('pochodnia zdradza: ten sam gracz w tej samej ciemnej komórce', () => {
    const g = hall(0);
    const obserwator = goblin(10, 10, 0);
    expect(canSee(obserwator, player(16, 10, 0, 0.05), g, MPC)).toBe(false);
    expect(canSee(obserwator, player(16, 10, 0, 0.9), g, MPC)).toBe(true);
  });

  it('światło komórki czyta się tą samą regułą co w rendererze', () => {
    // górna połówka pusta, dolna niesie wartość — tak wyglądają paczki na SpanGrid
    expect(cellLight(hall(15), 12, 10)).toBeCloseTo(1, 5);
    expect(cellLight(hall(6), 12, 10)).toBeCloseTo(0.4, 5);
    expect(cellLight(hall(0), 12, 10)).toBe(0);
  });

  it('półmrok skraca zasięg, a nie zaciemnia wszystko naraz', () => {
    const g = hall(6);
    const lum = cellLight(g, 12, 10);
    const obserwator = goblin(10, 10, 0);
    const zasieg = PERCEPTION.sightM * lum;
    expect(canSee(obserwator, player(10 + zasieg / MPC - 1, 10, 0, lum), g, MPC)).toBe(true);
    expect(canSee(obserwator, player(10 + zasieg / MPC + 1, 10, 0, lum), g, MPC)).toBe(false);
  });

  it('hałas nie zależy od światła — biegnącego słychać w ciemności', () => {
    const ciemno = hall(0);
    const obserwator = goblin(10, 10, 0);
    const biegnacy = player(10, 18, 0, 0);
    biegnacy.running = true;
    const skradajacy = player(10, 18, 0, 0);
    expect(canSee(obserwator, biegnacy, ciemno, MPC)).toBe(false);
    expect(canHear(obserwator, biegnacy, MPC)).toBe(true);
    expect(canHear(obserwator, skradajacy, MPC)).toBe(false);
  });
});

describe('linia wzroku', () => {
  it('mur zasłania, otwarta hala nie', () => {
    const g = hall();
    expect(hasLineOfSight(g, 10, 10, 1.5, 30, 10, 1.5, MPC)).toBe(true);
    addWall(g);
    expect(hasLineOfSight(g, 10, 10, 1.5, 30, 10, 1.5, MPC)).toBe(false);
  });

  it('sprite za murem nie jest widziany, choć jest w stożku i w świetle', () => {
    const g = hall();
    addWall(g);
    const obserwator = goblin(10, 10, 0);
    expect(canSee(obserwator, player(30, 10), g, MPC)).toBe(false);
  });
});

describe('maszyna stanów', () => {
  const rng = mulberry32(7);

  /**
   * Kilka kroków AI. Przejście stanu kosztuje jedną klatkę — byt najpierw
   * zauważa, a dopiero w następnej klatce działa. To jest zamierzone: natychmiastowa
   * reakcja na pojawienie się gracza w kadrze wygląda jak oszustwo.
   */
  function pompuj(gob: Being, gracz: Being, g: SpanGrid, intent: Intent, kroki = 3): void {
    for (let i = 0; i < kroki; i++) updateAi(gob, gracz, g, 16, rng, intent, MPC);
  }

  it('spokój → pościg → walka, gdy gracz podchodzi', () => {
    const g = hall();
    const gob = goblin(10, 10, 0);
    const gracz = player(24, 10);
    const intent = makeIntent();

    pompuj(gob, gracz, g, intent);
    expect(gob.ai).toBe(AiState.Hunting);
    expect(intent.vx).toBeGreaterThan(0);

    gracz.x = 10.9;
    gracz.y = 10;
    pompuj(gob, gracz, g, intent);
    expect(gob.ai).toBe(AiState.Fighting);
  });

  it('stracony z oczu: szuka, a potem wraca do spokoju', () => {
    const g = hall(0);
    const gob = goblin(10, 10, 0);
    gob.ai = AiState.Suspicious as AiState; // przypisanie nie zawęża typu pola
    // gracz w ciemności i daleko: ani go nie widać, ani nie słychać
    const gracz = player(34, 10, 0, 0);
    const intent = makeIntent();

    let t = 0;
    while (t < PERCEPTION.searchMs + 100 && gob.ai !== AiState.Idle) {
      updateAi(gob, gracz, g, 100, rng, intent, MPC);
      t += 100;
    }
    expect(gob.ai).toBe(AiState.Idle);
    expect(t).toBeGreaterThan(PERCEPTION.searchMs);
  });

  it('ranny ucieka zamiast walczyć do śmierci', () => {
    const g = hall();
    const gob = goblin(10, 10, 0);
    const gracz = player(10.9, 10);
    const intent = makeIntent();
    pompuj(gob, gracz, g, intent);
    expect(gob.ai).toBe(AiState.Fighting);

    gob.actor.hp = gob.actor.maxHp * (PERCEPTION.fleeHpFraction - 0.01);
    pompuj(gob, gracz, g, intent, 2);
    expect(gob.ai).toBe(AiState.Fleeing);
    // ucieka od gracza, nie do niego
    expect(intent.vx).toBeLessThan(0);
    expect(intent.running).toBe(true);
  });

  it('trup nie ma zamiarów', () => {
    const g = hall();
    const gob = goblin(10, 10, 0);
    gob.actor.hp = 0;
    gob.actor.stance = Stance.Dead;
    const intent = makeIntent();
    intent.vx = 5;
    updateAi(gob, player(12, 10), g, 16, rng, intent, MPC);
    expect(intent.vx).toBe(0);
    expect(intent.vy).toBe(0);
  });

  it('AI nigdy nie wpada w stan bez wyjścia', () => {
    // Dziesięć tysięcy kroków z losowo skaczącym graczem: każdy stan musi dać się
    // opuścić, a zamiar ruchu ma zawsze być liczbą.
    const g = hall(9);
    const gob = goblin(20, 20, 0);
    const gracz = player(20, 20, 0, 0.6);
    const intent = makeIntent();
    const r = mulberry32(99);
    const odwiedzone = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      gracz.x = 2 + r() * (HALL - 4);
      gracz.y = 2 + r() * (HALL - 4);
      gracz.running = r() < 0.5;
      if (r() < 0.001) gob.actor.hp = gob.actor.maxHp;
      updateAi(gob, gracz, g, 16, r, intent, MPC);
      expect(Number.isFinite(intent.vx)).toBe(true);
      expect(Number.isFinite(intent.vy)).toBe(true);
      expect(Number.isFinite(gob.yaw)).toBe(true);
      odwiedzone.add(gob.ai);
    }
    expect(odwiedzone.size).toBeGreaterThan(2);
  });
});
