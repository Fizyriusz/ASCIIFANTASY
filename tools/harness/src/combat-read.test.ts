import { describe, it, expect } from 'vitest';
import { compileSprite, drawSprites, renderWorld } from '@rpg/core';
import type { Screen, SpriteInstance } from '@rpg/core';
import { FEEDBACK, Frame, inkOf, weapons, wildCreatures } from '@rpg/content';
import { EventKind, dimScreen, drawLog, makeEventLog, pushEvent, tickLog } from '@rpg/ui';
import { assertSnapshot } from './snapshot.js';
import { DUNGEON_VIEWS, dungeonScene, referenceScreen, wildContext, wildScene } from './scene.js';

const MPC = 2; // metry na komórkę
const def = wildCreatures[0];
if (def === undefined) throw new Error('paczka bez potworów');
const art = compileSprite(def.art, { r: def.r, g: def.g, b: def.b }, def.heightM, def.widthM);

function byt(x: number, y: number, z: number, yaw: number, frame: number, lum: number, blysk = false): SpriteInstance {
  const inst: SpriteInstance = { x, y, baseZ: z, yaw, frame, lum, frames: art };
  if (blysk) {
    const k = FEEDBACK.hitFlashMix;
    inst.r = def!.r + (255 - def!.r) * k;
    inst.g = def!.g + (255 - def!.g) * k;
    inst.b = def!.b + (255 - def!.b) * k;
  }
  return inst;
}

/** kanały ze spakowanej barwy 15-bitowej, w skali 0..255 */
function rgb(p: number): [number, number, number] {
  return [((p >> 10) & 31) * 8, ((p >> 5) & 31) * 8, (p & 31) * 8];
}

function meanLum(s: Screen): number {
  let sum = 0;
  for (let i = 0; i < s.colors.length; i++) {
    const [r, g, b] = rgb(s.colors[i] ?? 0);
    sum += (r + g + b) / 3;
  }
  return sum / s.colors.length;
}

/** Kadr walki: świat, byt w zadanej klatce, dziennik. Wspólny dla snapshotów. */
function kadrWalki(frame: number, blysk: boolean, wpisy: [string, EventKind][], odlegloscM = 1.5): Screen {
  // Scena `torch`, a nie `corridor`: ta druga patrzy w dół biegu schodów i byt
  // z półtora metra jest tam zasłonięty geometrią, czyli nie widać nic, o co
  // w tym teście chodzi.
  const s = dungeonScene('torch');
  const v = DUNGEON_VIEWS.torch;
  const screen = referenceScreen();
  renderWorld(s.store, s.camera, screen, s.ctx);
  const d = odlegloscM / MPC;
  const x = v.x + Math.cos(v.yaw) * d;
  const y = v.y + Math.sin(v.yaw) * d;
  const z = s.store.spanTop(Math.floor(x), Math.floor(y), 0);
  drawSprites(screen, s.camera, s.ctx, [byt(x, y, z, v.yaw + Math.PI, frame, 0.85, blysk)], 1);
  const log = makeEventLog();
  for (const [tekst, rodzaj] of wpisy) pushEvent(log, tekst, rodzaj);
  drawLog(screen, 1, screen.rows - 2, log);
  return screen;
}

describe('telegraf ataku', () => {
  /**
   * Ile z **widocznej** sylwetki zmienia się między spokojem a zamachem. Liczymy
   * tylko komórki, które sprite faktycznie zamalował w kadrze: różnica zapisana
   * w wierszach poza ekranem nie istnieje, a w zwarciu poza ekranem jest większość
   * ciała (przy 1,4 m widać 18% sylwetki).
   */
  function roznicaKlatek(m: number): { procent: number; gornaIdle: number; gornaAtak: number } {
    const s = wildScene('hills');
    const ctx = wildContext();
    const d = m / MPC;
    const x = s.camera.x + Math.cos(s.camera.yaw) * d;
    const y = s.camera.y + Math.sin(s.camera.yaw) * d;
    const z = s.store.spanTop(Math.floor(x), Math.floor(y), 0);

    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, ctx);
    const idle = referenceScreen();
    renderWorld(s.store, s.camera, idle, ctx);
    drawSprites(idle, s.camera, ctx, [byt(x, y, z, s.camera.yaw + Math.PI, Frame.Idle, 0.9)], 1);
    const atak = referenceScreen();
    renderWorld(s.store, s.camera, atak, ctx);
    drawSprites(atak, s.camera, ctx, [byt(x, y, z, s.camera.yaw + Math.PI, Frame.Attack, 0.9)], 1);

    let widoczne = 0;
    let rozne = 0;
    let gornaIdle = idle.rows;
    let gornaAtak = idle.rows;
    for (let i = 0; i < idle.chars.length; i++) {
      const r = Math.floor(i / idle.cols);
      if ((idle.chars[i] ?? 0) !== (pusty.chars[i] ?? 0)) {
        widoczne++;
        if (r < gornaIdle) gornaIdle = r;
      }
      if ((atak.chars[i] ?? 0) !== (pusty.chars[i] ?? 0) && r < gornaAtak) gornaAtak = r;
      if ((idle.chars[i] ?? 0) !== (atak.chars[i] ?? 0)) rozne++;
    }
    return { procent: (rozne / Math.max(1, widoczne)) * 100, gornaIdle, gornaAtak };
  }

  it('zamach zmienia co najmniej trzecią część widocznej sylwetki', () => {
    // Progi na 1,5 / 3 / 6 m, bo tam przeciwnik dosięga. Przed zmianą rysunku
    // było 0% / 9% / 8% — zamach był zapisany w dwóch znakach w połowie ciała,
    // czyli w części, której w zwarciu nie widać.
    for (const m of [1.5, 3, 6]) {
      const r = roznicaKlatek(m);
      expect(r.procent).toBeGreaterThan(35);
    }
  });

  it('sylwetka rośnie w górę, bo tylko góra jest widoczna w zwarciu', () => {
    for (const m of [1.5, 3]) {
      const r = roznicaKlatek(m);
      expect(r.gornaAtak).toBeLessThan(r.gornaIdle);
    }
  });

  it('broń potwora ma zamach dłuższy niż czas reakcji człowieka', () => {
    // 350 ms to dolna granica sensu: reakcja wzrokowa to 200-300 ms, a jedna klatka
    // przy 60 fps zjada jeszcze 16 ms. Nie ma pola `telegraphMs` — animacja i mechanika
    // mają być tą samą rzeczą, inaczej gra kłamie graczowi.
    for (const c of wildCreatures) {
      if (c.weapon === null) continue;
      const w = weapons[c.weapon];
      expect(w).toBeDefined();
      expect(w!.windupMs).toBeGreaterThanOrEqual(350);
    }
  });

  it('combat-telegraph: spokój i zamach z 1,5 / 3 / 6 m', () => {
    for (const m of [1.5, 3, 6]) {
      const s = wildScene('hills');
      const ctx = wildContext();
      const d = m / MPC;
      const x = s.camera.x + Math.cos(s.camera.yaw) * d;
      const y = s.camera.y + Math.sin(s.camera.yaw) * d;
      const z = s.store.spanTop(Math.floor(x), Math.floor(y), 0);
      const screen = referenceScreen();
      renderWorld(s.store, s.camera, screen, ctx);
      drawSprites(screen, s.camera, ctx, [byt(x, y, z, s.camera.yaw + Math.PI, Frame.Attack, 0.9)], 1);
      assertSnapshot(`combat-telegraph-${m}m`, screen.toText());
    }
  });
});

describe('kontrast sprite do tła', () => {
  /**
   * Odległość barwy i różnica pokrycia atramentem między komórką z bytem a tą samą
   * komórką bez niego. Barwa jest liczona po kwantyzacji do 15 bitów, czyli w tej
   * samej przestrzeni, w której gracz to widzi.
   */
  function kontrast(nazwa: 'łąka' | 'las' | 'loch', m: number): { med: number; p05: number } {
    const dungeon = nazwa === 'loch' ? dungeonScene('room') : null;
    const wild = nazwa === 'łąka' ? wildScene('hills') : nazwa === 'las' ? wildScene('forest') : null;
    const store = dungeon !== null ? dungeon.store : wild!.store;
    const cam = dungeon !== null ? dungeon.camera : wild!.camera;
    const ctx = dungeon !== null ? dungeon.ctx : wildContext();
    const d = m / MPC;
    const x = cam.x + Math.cos(cam.yaw) * d;
    const y = cam.y + Math.sin(cam.yaw) * d;
    const z = store.spanTop(Math.floor(x), Math.floor(y), 0);

    const pusty = referenceScreen();
    renderWorld(store, cam, pusty, ctx);
    const zByt = referenceScreen();
    renderWorld(store, cam, zByt, ctx);
    drawSprites(zByt, cam, ctx, [byt(x, y, z, cam.yaw + Math.PI, Frame.Idle, 0.8)], 1);

    const barwy: number[] = [];
    for (let i = 0; i < zByt.chars.length; i++) {
      if ((zByt.chars[i] ?? 0) === (pusty.chars[i] ?? 0) && (zByt.colors[i] ?? 0) === (pusty.colors[i] ?? 0)) {
        continue;
      }
      const [r1, g1, b1] = rgb(zByt.colors[i] ?? 0);
      const [r2, g2, b2] = rgb(pusty.colors[i] ?? 0);
      barwy.push(Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2));
    }
    barwy.sort((a, b) => a - b);
    if (barwy.length === 0) return { med: 0, p05: 0 };
    return { med: barwy[barwy.length >> 1] ?? 0, p05: barwy[Math.floor(barwy.length * 0.05)] ?? 0 };
  }

  it('byt odcina się od każdego biomu, także z szesnastu metrów', () => {
    // Progi z pomiaru, nie z sufitu. Zielony goblin sprzed zmiany dawał w lesie
    // medianę 24 i p05 20 — czyli zlewał się z liśćmi. Dystanse są tu inne niż
    // przy telegrafie i mają takie zostać: tu pytamy, czy zauważysz potwora,
    // ZANIM podejdzie.
    for (const scena of ['łąka', 'las', 'loch'] as const) {
      for (const m of [4, 8, 16]) {
        const k = kontrast(scena, m);
        expect(k.med).toBeGreaterThan(60);
        expect(k.p05).toBeGreaterThan(40);
      }
    }
  });

  it('atrament sprite wyraźnie różni się od atramentu tła', () => {
    // Osobna oś od barwy. Zlecenie mówiło „cięższe glify" — pomiar pokazał, że
    // to jest niewykonalne bez utraty czytelności sylwetki: łąka jest gęsta
    // (średnie pokrycie 0,27 na komórkę, bo to `%` i `&`), a postać z natury składa
    // się z kresek `|`, `,` i `^` (0,17). Zrobienie jej cięższej od trawy znaczy
    // wypełnienie jej `#`, czyli zamianę figury w plamę. Kontrast niesie więc barwa,
    // a atrament ma się od tła **różnić**, nie przeważać.
    // Wersja przed zmianą palety: 0,15 różnicy; ten test pilnuje, żeby nie spadła.
    const s = wildScene('hills');
    const ctx = wildContext();
    const d = 4 / MPC;
    const x = s.camera.x + Math.cos(s.camera.yaw) * d;
    const y = s.camera.y + Math.sin(s.camera.yaw) * d;
    const z = s.store.spanTop(Math.floor(x), Math.floor(y), 0);
    const pusty = referenceScreen();
    renderWorld(s.store, s.camera, pusty, ctx);
    const zByt = referenceScreen();
    renderWorld(s.store, s.camera, zByt, ctx);
    drawSprites(zByt, s.camera, ctx, [byt(x, y, z, s.camera.yaw + Math.PI, Frame.Idle, 0.9)], 1);

    let suma = 0;
    let n = 0;
    for (let i = 0; i < zByt.chars.length; i++) {
      if ((zByt.chars[i] ?? 0) === (pusty.chars[i] ?? 0)) continue;
      suma += Math.abs(inkOf(zByt.chars[i] ?? 0) - inkOf(pusty.chars[i] ?? 0));
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(suma / n).toBeGreaterThan(0.1);
  });
});

describe('potwierdzenie trafienia', () => {
  it('cztery wyniki ciosu dają cztery różne obrazy', () => {
    const hit = kadrWalki(Frame.Hit, true, [['trafiony', EventKind.Good]]);
    // zablokowany cios: kontakt był, więc jest rozbłysk, ale nie ma klatki `Hit` —
    // bez tego „goblin zablokował" i „pudło" różnią się wyłącznie tekstem
    const blocked = kadrWalki(Frame.Idle, true, [['goblin zablokował', EventKind.Neutral]]);
    const miss = kadrWalki(Frame.Idle, false, [['pudło', EventKind.Neutral]]);
    const mojBlok = kadrWalki(Frame.Attack, true, [['zablokowane', EventKind.Good]]);

    assertSnapshot('combat-hit', hit.toText());
    assertSnapshot('combat-blocked', blocked.toText());
    assertSnapshot('combat-miss', miss.toText());
    assertSnapshot('combat-player-blocked', mojBlok.toText());

    const kadry = [hit, blocked, miss, mojBlok];
    for (let i = 0; i < kadry.length; i++) {
      for (let j = i + 1; j < kadry.length; j++) {
        let rozne = 0;
        for (let k = 0; k < kadry[i]!.chars.length; k++) {
          if (
            (kadry[i]!.chars[k] ?? 0) !== (kadry[j]!.chars[k] ?? 0) ||
            (kadry[i]!.colors[k] ?? 0) !== (kadry[j]!.colors[k] ?? 0)
          ) {
            rozne++;
          }
        }
        expect(rozne).toBeGreaterThan(20);
      }
    }
  });

  it('rozbłysk zmienia barwę bytu, a nie tylko jego jasność', () => {
    // Podbicie luminancji powyżej jedynki `shade` przycina do bieli i byt gubi
    // barwę zamiast błysnąć — dlatego błysk idzie przez podmianę barwy.
    const zwykly = kadrWalki(Frame.Hit, false, []);
    const blysk = kadrWalki(Frame.Hit, true, []);
    let jasniejsze = 0;
    for (let i = 0; i < zwykly.colors.length; i++) {
      if ((zwykly.chars[i] ?? 0) === 0) continue;
      const [r1, g1, b1] = rgb(zwykly.colors[i] ?? 0);
      const [r2, g2, b2] = rgb(blysk.colors[i] ?? 0);
      if (r2 + g2 + b2 > r1 + g1 + b1) jasniejsze++;
    }
    expect(jasniejsze).toBeGreaterThan(20);
  });
});

describe('reakcja kadru na oberwanie', () => {
  it('przyciemnienie mierzy się luminancją, nie snapshotem', () => {
    const przed = kadrWalki(Frame.Idle, false, []);
    const jasnoscPrzed = meanLum(przed);
    dimScreen(przed, FEEDBACK.hurtDim);
    const jasnoscPo = meanLum(przed);
    // efekt ma być wyraźny...
    expect(jasnoscPo).toBeLessThan(jasnoscPrzed * 0.7);
    // ...ale nie może gasić obrazu do zera, bo wtedy nie widać, kto cię bije
    expect(jasnoscPo).toBeGreaterThan(jasnoscPrzed * 0.2);
  });

  it('combat-player-hurt: po wygaśnięciu efektu kadr wraca do stanu sprzed ciosu', () => {
    // Snapshot z klatki PO efekcie, bo przyciemnienie zmienia każdą komórkę
    // i jako test odróżniałoby wszystko od wszystkiego.
    const s = kadrWalki(Frame.Idle, false, [['oberwałeś', EventKind.Bad]]);
    assertSnapshot('combat-player-hurt', s.toText());
    const czysty = kadrWalki(Frame.Idle, false, [['oberwałeś', EventKind.Bad]]);
    dimScreen(czysty, 1);
    expect(czysty.toText()).toBe(s.toText());
  });
});

describe('linia zdarzeń', () => {
  it('combat-log: trzy wpisy w kolejce', () => {
    const s = kadrWalki(Frame.Idle, false, [
      ['minął cię', EventKind.Neutral],
      ['zablokowane', EventKind.Good],
      ['brak wytrzymałości', EventKind.Bad],
    ]);
    assertSnapshot('combat-log', s.toText());
  });

  it('kolejka nie rośnie ponad limit i gaśnie po zadanym czasie', () => {
    const log = makeEventLog();
    for (let i = 0; i < 10; i++) pushEvent(log, `zdarzenie ${i}`);
    expect(log.text.length).toBe(FEEDBACK.logLines);
    expect(log.text[log.text.length - 1]).toBe('zdarzenie 9');

    tickLog(log, FEEDBACK.logFadeMs + 1);
    expect(log.text.length).toBe(0);
  });

  it('powtórzony wpis odświeża istniejący zamiast wypychać kolejkę', () => {
    const log = makeEventLog();
    pushEvent(log, 'trafiony');
    pushEvent(log, 'pudło');
    tickLog(log, 500);
    pushEvent(log, 'pudło');
    expect(log.text.length).toBe(2);
    expect(log.age[1]).toBe(0);
    expect(log.age[0]).toBe(500);
  });
});
