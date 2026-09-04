import { describe, it, expect } from 'vitest';
import { compileSprite, drawSprites, renderWorld } from '@rpg/core';
import { Armor, COMBAT, PLAYER, Weapon, wildCreatures } from '@rpg/content';
import { CELL_METERS } from '@rpg/world';
import { mulberry32 } from '@rpg/world';
import {
  Skill,
  Stance,
  Swing,
  beginAttack,
  defenseOf,
  equipArmor,
  equipWeapon,
  hitChance,
  makeActor,
  makeAttackResult,
  makeBeing,
  reachOf,
  serviceSwing,
} from '@rpg/rules';
import type { Being } from '@rpg/rules';
import { DUNGEON_VIEWS, dungeonScene, referenceScreen } from './scene.js';

/**
 * POMIAR, NIE POPRAWKA. Rozbicie chybień gracza na przyczyny przy nieruchomym celu.
 *
 * Ścieżka jest ta sama, co w grze: `beginAttack`, potem `serviceSwing` co klatkę
 * 16 ms, aż zamach dojdzie. Gracz stoi, goblin stoi. Statystyki gracza jak w grze,
 * ale ostrze podniesione do 35 — tyle ma gracz po kilku walkach.
 */

const KLATKA = 16;
const SKILL_OSTRZA = 35;
const PLAYER_HEIGHT = 1.85;
const PLAYER_EYE = 1.7;

const goblinDef = wildCreatures[0];
if (goblinDef === undefined) throw new Error('paczka bez potworów');

function gracz(): Being {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  a.skills[Skill.Blade] = SKILL_OSTRZA;
  return makeBeing(a, 0, 0, 0, 0, -1, 1.9, 4.4, PLAYER_HEIGHT, PLAYER_EYE);
}

function goblin(dystansM: number): Being {
  const d = goblinDef!;
  const a = makeActor(d.hp, d.stamina, d.attrs, d.skills);
  if (d.weapon !== null) equipWeapon(a, d.weapon);
  const b = makeBeing(
    a,
    dystansM / CELL_METERS,
    0,
    0,
    Math.PI,
    0,
    d.walkMps,
    d.runMps,
    d.heightM,
    d.heightM * 0.85,
  );
  b.actor.hp = 1e6; // cel ma przeżyć sto ciosów: mierzymy chybienia, nie zabijanie
  b.actor.maxHp = 1e6;
  return b;
}

interface Rozbicie {
  poza: number;
  luk: number;
  pion: number;
  rzut: number;
  blok: number;
  unik: number;
  /** ciosy, które doszły z najsłabszym rzutem — dawniej byłyby pudłem */
  musniecia: number;
  trafione: number;
}

/** Postawa celu w chwili ciosu — zwykły stojący goblin, blokujący albo w oknie uniku. */
type Postawa = 'stoi' | 'blokuje' | 'unika';

/** Sto ciosów tą samą ścieżką, co w grze. `pitch` to kąt patrzenia gracza. */
function stoCiosow(dystansM: number, pitch: number, seed: number, postawa: Postawa = 'stoi'): Rozbicie {
  const p = gracz();
  const g = goblin(dystansM);
  p.pitch = pitch;
  const rng = mulberry32(seed);
  const out = makeAttackResult();
  const r: Rozbicie = {
    poza: 0,
    luk: 0,
    pion: 0,
    rzut: 0,
    blok: 0,
    unik: 0,
    musniecia: 0,
    trafione: 0,
  };

  for (let i = 0; i < 100; i++) {
    // Świeży stan przed każdym ciosem: mierzymy pojedynczy cios, a nie wyczerpanie
    // ani naukę umiejętności w trakcie serii.
    p.actor.stamina = p.actor.maxStamina;
    p.actor.stance = Stance.Idle;
    p.actor.stanceMs = 0;
    p.actor.skills[Skill.Blade] = SKILL_OSTRZA;
    g.actor.stance = postawa === 'blokuje' ? Stance.Blocking : Stance.Idle;
    g.actor.stanceMs = 0;
    g.actor.dodgeMs = postawa === 'unika' ? COMBAT.dodgeWindowMs : 0;
    g.actor.stamina = g.actor.maxStamina;

    expect(beginAttack(p.actor)).toBe(true);
    let cios: Swing = Swing.None;
    for (let k = 0; k < 200 && cios === Swing.None; k++) {
      cios = serviceSwing(p, g, KLATKA, rng, out, CELL_METERS);
    }
    if (cios === Swing.OutOfReach) r.poza++;
    else if (cios === Swing.OffAngle) r.luk++;
    else if (cios === Swing.OffAim) r.pion++;
    else if (out.blocked) r.blok++;
    else if (out.dodged) r.unik++;
    else if (out.landed) {
      r.trafione++;
      if (out.quality <= COMBAT.grazeDamage) r.musniecia++;
    } else r.rzut++;
  }
  return r;
}

function wiersz(nazwa: string, r: Rozbicie): string {
  const chybione = 100 - r.trafione;
  return (
    `${nazwa.padEnd(26)} trafione ${String(r.trafione).padStart(3)}% (w tym muśnięć ` +
    `${String(r.musniecia).padStart(3)}%)  chybione ${String(chybione).padStart(3)}%  ` +
    `| poza zasięgiem ${r.poza}%  poza łukiem ${r.luk}%  poza pionem ${r.pion}%  ` +
    `rzut ${r.rzut}%  blok ${r.blok}%  unik ${r.unik}%`
  );
}

describe('pomiar: dlaczego cios gracza nie dochodzi', () => {
  it('sto ciosów w nieruchomy cel, trzy dystanse, dwa style patrzenia', () => {
    const zasieg = reachOf(gracz());
    const dystanse: [string, number][] = [
      ['tuż przy celu (0,6 m)', 0.6],
      [`pół zasięgu (${(zasieg / 2).toFixed(2)} m)`, zasieg / 2],
      [`granica zasięgu (${(zasieg - 0.05).toFixed(2)} m)`, zasieg - 0.05],
    ];
    console.log(`zasięg ciosu: ${zasieg.toFixed(2)} m (broń 1,6 m + 0,5 m na ciała)`);
    console.log('--- gracz patrzy poziomo (pitch 0) ---');
    for (const [nazwa, d] of dystanse) {
      const r = stoCiosow(d, 0, 7 + Math.round(d * 100));
      console.log(wiersz(nazwa, r));
      // Kryterium poprawki: w zwarciu, przy nieruchomym celu i poziomym patrzeniu,
      // nie wolno stracić ani jednego ciosu. Przed zmianą było tu 100% chybień.
      expect(r.pion).toBe(0);
      expect(r.rzut).toBe(0);
      expect(r.trafione).toBe(100);
    }

    console.log('--- gracz celuje w środek sylwetki goblina ---');
    for (const [nazwa, d] of dystanse) {
      const srodek = goblinDef.heightM / 2 - PLAYER_EYE;
      const pitch = Math.atan2(srodek, d);
      console.log(
        wiersz(`${nazwa} @ ${((pitch * 180) / Math.PI).toFixed(0)}°`, stoCiosow(d, pitch, 7 + Math.round(d * 100))),
      );
    }

    // Trzeci przypadek: cel nie stoi bezczynnie. Bez tego kubełek „blok albo unik"
    // zostaje pusty i wygląda, jakby obrona przeciwnika nic nie kosztowała.
    console.log('--- cel się broni, gracz celuje w sylwetkę, pół zasięgu ---');
    const d = zasieg / 2;
    const pitch = Math.atan2(goblinDef.heightM / 2 - PLAYER_EYE, d);
    console.log(wiersz('goblin blokuje', stoCiosow(d, pitch, 11, 'blokuje')));
    console.log(wiersz('goblin w oknie uniku', stoCiosow(d, pitch, 11, 'unika')));
    expect(true).toBe(true);
  });

  it('sama szansa czystego ciosu z wzoru i długość serii muśnięć', () => {
    const p = gracz();
    const g = goblin(1);
    const szansa = hitChance(p.actor, g.actor);
    const obrona = defenseOf(g.actor);
    console.log(
      `baza ${COMBAT.baseHit} + ostrze ${SKILL_OSTRZA}×${COMBAT.hitPerSkill} + zręczność ` +
        `${p.actor.attrs[1]}×${COMBAT.hitPerAgi} − obrona goblina ${obrona.toFixed(4)} = ` +
        `${szansa.toFixed(4)} (${(szansa * 100).toFixed(1)}%)`,
    );
    // Ten sam rzut, inne znaczenie: nie „czy cios istnieje", tylko „jak dobry".
    // Seria niskich rzutów to dziś seria muśnięć, a nie seria zdarzeń bez skutku —
    // hp przeciwnika spada przez cały czas i widać to na pasku.
    const q = 1 - szansa;
    console.log(
      `muśnięcie pod rząd: 2× ${(q ** 2 * 100).toFixed(1)}%, 3× ${(q ** 3 * 100).toFixed(1)}%, ` +
        `4× ${(q ** 4 * 100).toFixed(1)}%, 5× ${(q ** 5 * 100).toFixed(1)}%; ` +
        `oczekiwany czas do czystego ciosu ${(((1 / szansa) * 660) / 1000).toFixed(2)} s ` +
        `przy cyklu 660 ms — a obrażenia lecą od pierwszego ciosu`,
    );
    expect(szansa).toBeGreaterThan(0);
  });

  it('okno pionowe: przy jakim kącie patrzenia goblin jest w oknie', () => {
    // Okno liczone tak, jak w `serviceSwing`: przedział wysokości zajmowany przez
    // sylwetkę, rozszerzony marginesem z contentu **w metrach**, dopiero potem
    // zamieniony na kąt na dystansie celu.
    const barki = PLAYER_EYE;
    for (const d of [0.6, 1.05, 2.05, 3, 5]) {
      const doGlowy = Math.atan2(goblinDef.heightM + COMBAT.aimMarginM - barki, d);
      const doStop = Math.atan2(0 - COMBAT.aimMarginM - barki, d);
      const st = (v: number) => ((v * 180) / Math.PI).toFixed(1).padStart(6);
      console.log(
        `dystans ${d.toFixed(2)} m: okno od ${st(doStop)}° do ${st(doGlowy)}°  ` +
          `${doGlowy >= 0 ? 'poziome patrzenie mieści się' : 'poziome patrzenie WYPADA z okna'}`,
      );
      // w zasięgu broni (2,1 m) poziome patrzenie ma się mieścić zawsze
      if (d <= 2.05) expect(doGlowy).toBeGreaterThan(0);
    }
  });
});

describe('pomiar: co widać, a co liczą reguły', () => {
  it('gdzie jest goblin na ekranie, a gdzie okno trafienia', () => {
    // Rysunek i reguły muszą mówić to samo. Sprawdzamy to **rysując** goblina
    // prawdziwym rendererem i pytając, przy jakim kącie patrzenia sprite zakrywa
    // celownik — a osobno, przy jakim kącie `serviceSwing` uznaje cios.
    const scena = dungeonScene('room', { sources: true });
    const v = DUNGEON_VIEWS.room;
    const podloga = scena.store.spanTop(Math.floor(v.x), Math.floor(v.y), 0);
    const frames = compileSprite(
      goblinDef.art,
      { r: goblinDef.r, g: goblinDef.g, b: goblinDef.b },
      goblinDef.heightM,
      goblinDef.widthM,
    );

    const p = gracz();
    p.x = v.x;
    p.y = v.y;
    p.z = podloga;
    p.yaw = v.yaw;

    for (const dystansM of [0.6, 1.05, 2.05]) {
      const gx = v.x + Math.cos(v.yaw) * (dystansM / CELL_METERS);
      const gy = v.y + Math.sin(v.yaw) * (dystansM / CELL_METERS);
      const g = goblin(dystansM);
      g.x = gx;
      g.y = gy;
      g.z = podloga;

      const inst = {
        x: gx,
        y: gy,
        baseZ: podloga,
        yaw: v.yaw + Math.PI,
        frame: 0,
        lum: 0.9,
        frames,
      };

      let naCelownikuOd = NaN;
      let naCelownikuDo = NaN;
      let trafiaOd = NaN;
      let trafiaDo = NaN;
      const out = makeAttackResult();
      const rng = () => 0; // rzut zawsze udany: mierzymy geometrię, nie kości

      for (let stopnie = -85; stopnie <= 25; stopnie += 1) {
        const pitch = (stopnie * Math.PI) / 180;
        const screen = referenceScreen();
        const cam = { ...scena.camera, pitch };
        renderWorld(scena.store, cam, screen, scena.ctx);
        const cx = (screen.cols / 2) | 0;
        const cy = (screen.rows / 2) | 0;
        const przed = screen.chars[cy * screen.cols + cx];
        drawSprites(screen, cam, scena.ctx, [inst], 1);
        const naCelowniku = screen.chars[cy * screen.cols + cx] !== przed;
        if (naCelowniku) {
          if (Number.isNaN(naCelownikuOd)) naCelownikuOd = stopnie;
          naCelownikuDo = stopnie;
        }

        p.pitch = pitch;
        p.actor.stance = Stance.Idle;
        p.actor.stanceMs = 0;
        p.actor.stamina = p.actor.maxStamina;
        g.actor.stance = Stance.Idle;
        beginAttack(p.actor);
        let cios: Swing = Swing.None;
        for (let k = 0; k < 200 && cios === Swing.None; k++) {
          cios = serviceSwing(p, g, KLATKA, rng, out, CELL_METERS);
        }
        if (cios === Swing.Resolved) {
          if (Number.isNaN(trafiaOd)) trafiaOd = stopnie;
          trafiaDo = stopnie;
        }
      }
      console.log(
        `dystans ${dystansM.toFixed(2)} m: sprite zakrywa celownik od ${naCelownikuOd}° do ${naCelownikuDo}°, ` +
          `cios przechodzi od ${trafiaOd}° do ${trafiaDo}°`,
      );
      expect(trafiaOd).toBeLessThanOrEqual(naCelownikuOd);
      expect(trafiaDo).toBeGreaterThanOrEqual(naCelownikuDo);
    }
  });
});
