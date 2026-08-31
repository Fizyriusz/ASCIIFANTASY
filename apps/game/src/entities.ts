/**
 * Byty w grze: skąd się biorą, jak się ruszają i jak trafiają do renderera.
 *
 * Rozmnażanie jest **deterministyczne z seeda**, jak wszystko inne: klaster
 * 16×16 komórek dostaje hash, z hasha wychodzi liczba goblinów i ich pozycje.
 * Dzięki temu ten sam seed daje te same potwory w tych samych miejscach, a zapis
 * nie musi trzymać nikogo, kogo gracz jeszcze nie spotkał — dokładnie tak samo
 * jak z terenem.
 *
 * Ten plik jest w `apps/game`, a nie w `packages/sim`, bo skleja świat z regułami
 * i renderem naraz. Reguły nie znają geometrii, renderer nie zna reguł, a ktoś
 * musi znać jedno i drugie — i to jest właśnie warstwa gry.
 */

import { addSource, clearSources, compileSprite, lightAt } from '@rpg/core';
import type { LightRig, SpriteFrames, SpriteInstance } from '@rpg/core';
import { FEEDBACK, Frame, WILD_SPAWN, wildCreatures, wildPack } from '@rpg/content';
import { CELL_METERS, dungeonDwellers, dungeonLights, dungeonsNear, h32 } from '@rpg/world';
import type { ChunkStore, DungeonGraph, DungeonLight } from '@rpg/world';
import {
  AiState,
  Stance,
  equipWeapon,
  makeActor,
  makeBeing,
  makeIntent,
  serviceSwing,
  updateAi,
} from '@rpg/rules';
import type { AttackResult, Being, Intent } from '@rpg/rules';
import type { EntitySave } from '@rpg/world';

/** Bok klastra rozmnażania w komórkach. Mniejszy = gęściej i drożej. */
const CLUSTER = 16;
/** Ile klastrów wokół gracza sprawdzamy. 3 przy boku 16 to 96 komórek zasięgu. */
const CLUSTER_RING = 3;
/** Górna granica bytów w symulacji; więcej i tak nie zmieści się w kadrze. */
const MAX_BEINGS = 64;
/** metry: wysokość oczu bytu nad gruntem, do linii wzroku i do trafień */
const EYE_M = 1.2;

export interface Mob {
  being: Being;
  intent: Intent;
  /** klucz klastra, z którego wyszedł — żeby nie odrodzić go po śmierci */
  origin: string;
  /** ms: ile jeszcze trwa rozbłysk trafienia na sylwetce */
  flashMs: number;
}

/**
 * Co byty zrobiły graczowi w tej klatce. Jeden obiekt na całą pętlę, nadpisywany —
 * warstwa gry robi z tego wpisy do dziennika i efekty w kadrze.
 */
export interface MobReport {
  /** obrażenia, które doszły do gracza */
  damage: number;
  /** ktoś zamachnął się i cios doszedł do rozstrzygnięcia */
  swung: boolean;
  /** ...i został zatrzymany blokiem gracza */
  blocked: boolean;
  /** ...albo minął, bo gracz uskoczył */
  dodged: boolean;
  /** ...albo po prostu chybił */
  missed: boolean;
}

/** Skompilowane rysunki, po jednym na rodzaj bytu. Kompilacja jest jednorazowa. */
const frames: SpriteFrames[] = wildCreatures.map((c) =>
  compileSprite(c.art, { r: c.r, g: c.g, b: c.b }, c.heightM, c.widthM),
);

export class Bestiary {
  readonly mobs: Mob[] = [];
  /**
   * Miejsca już rozpatrzone: klaster powierzchni (`"kx:ky"`) albo komora lochu
   * (`"poi:komora"`). Bez tego byty odradzają się co klatkę, a po wczytaniu zapisu
   * — po raz drugi obok tych, które właśnie wróciły z pliku.
   */
  private readonly seen = new Set<string>();
  private readonly sprites: SpriteInstance[] = [];
  /** żagwie lochu, w którym gracz się znajduje; puste na powierzchni */
  private lights: readonly DungeonLight[] = [];
  /** znaczniki „już wzięte" przy wyborze najbliższych źródeł — bufor, nie alokacja */
  private usedLights = new Uint8Array(64);
  /** loch, którego zawartość jest już policzona — żeby nie liczyć jej co klatkę */
  private lochId = -1;

  constructor(
    private readonly seed: number,
    private readonly world: ChunkStore,
  ) {}

  /**
   * Dorzuca byty z klastrów wokół gracza. Wywoływane co klatkę, ale kosztuje
   * cokolwiek tylko przy wejściu w nowy klaster — reszta to `Set.has`.
   */
  spawnAround(px: number, py: number, pz: number): void {
    // Pod stropem klastry powierzchni nie obowiązują. Bez tego warunku zejście
    // do lochu **zużywa** klastry łąki nad nim: byty stają na trawie, a gracz
    // pod ziemią nie spotyka nikogo — i już nigdy nie spotka, bo klaster raz
    // rozpatrzony nie wraca.
    if (this.underground(px, py, pz)) {
      this.populateDungeon(px, py, pz);
      return;
    }
    this.lights = [];
    this.lochId = -1;

    const cx = Math.floor(px / CLUSTER);
    const cy = Math.floor(py / CLUSTER);
    for (let dy = -CLUSTER_RING; dy <= CLUSTER_RING; dy++) {
      for (let dx = -CLUSTER_RING; dx <= CLUSTER_RING; dx++) {
        const kx = cx + dx;
        const ky = cy + dy;
        const key = `${kx}:${ky}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        this.spawnCluster(kx, ky, pz);
      }
    }
  }

  private spawnCluster(kx: number, ky: number, pz: number): void {
    const h = h32(this.seed ^ 0x60b1, kx, ky, 0) >>> 0;
    // Gęstość i rozmiar grupy są w contencie, bo to liczby balansu: groźba ma
    // wychodzić z liczebności, a nie z siły pojedynczego przeciwnika.
    if (h % WILD_SPAWN.oneInClusters !== 0) return;
    const rozpietosc = WILD_SPAWN.packMax - WILD_SPAWN.packMin + 1;
    const count = WILD_SPAWN.packMin + ((h >>> 8) % rozpietosc);
    for (let i = 0; i < count; i++) {
      if (this.mobs.length >= MAX_BEINGS) return;
      const hp = h32(h, i, 0, 0) >>> 0;
      const x = kx * CLUSTER + (hp % CLUSTER) + 0.5;
      const y = ky * CLUSTER + ((hp >>> 8) % CLUSTER) + 0.5;
      // Pułap szukania gruntu to wysokość gracza plus trzy metry, a nie
      // nieskończoność: pod ziemią „najwyższa czapka" to strop nad jaskinią,
      // więc bez tego wszystkie gobliny lądują na łące nad lochem.
      const z = this.world.surfaceHeight(Math.floor(x), Math.floor(y), pz + 3);
      if (!Number.isFinite(z)) continue;
      // nie stawiamy nikogo tam, gdzie nie zmieści się jego własna sylwetka
      if (this.world.blocks(Math.floor(x), Math.floor(y), z + 0.1, z + 1.6)) continue;
      this.mobs.push(this.makeGoblin(x, y, z, ((hp >>> 16) % 628) / 100, `${kx}:${ky}`));
    }
  }

  /** Czy nad graczem jest bryła — najtańszy sprawdzian „jestem pod ziemią". */
  private underground(px: number, py: number, pz: number): boolean {
    const nad = this.world.surfaceHeight(Math.floor(px), Math.floor(py), 1e6);
    return Number.isFinite(nad) && nad > pz + 3;
  }

  /**
   * Zawartość lochu, w którym stoi gracz: mieszkańcy komór i żagwie. Liczona raz
   * na loch, nie co klatkę — `lochId` pilnuje, żeby wejście do tej samej komory
   * po raz drugi nic nie kosztowało.
   *
   * Świat proponuje pozycje, tutaj sprawdzamy, czy sylwetka się w nich mieści:
   * reguły geometrii są po tej stronie, bo to warstwa gry zna kolizję.
   */
  private populateDungeon(px: number, py: number, pz: number): void {
    const graf = this.dungeonAt(px, py, pz);
    if (graf === null) return;
    if (graf.poiId !== this.lochId) {
      this.lochId = graf.poiId;
      this.lights = dungeonLights(this.seed, graf);
      if (this.lights.length > this.usedLights.length) {
        this.usedLights = new Uint8Array(this.lights.length);
      }
    }
    for (const d of dungeonDwellers(this.seed, graf)) {
      if (this.mobs.length >= MAX_BEINGS) return;
      const key = `${graf.poiId}:${d.roomIndex}:${d.x}:${d.y}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const z = this.world.surfaceHeight(Math.floor(d.x), Math.floor(d.y), d.z + 2);
      if (!Number.isFinite(z)) continue;
      if (this.world.blocks(Math.floor(d.x), Math.floor(d.y), z + 0.1, z + 1.6)) continue;
      this.mobs.push(this.makeGoblin(d.x, d.y, z, 0, `${graf.poiId}:${d.roomIndex}`));
    }
  }

  /** Loch, którego obwiednia obejmuje gracza i którego podłogi sięgają jego poziomu. */
  private dungeonAt(px: number, py: number, pz: number): DungeonGraph | null {
    for (const g of dungeonsNear(this.seed, px - 512, py - 512, px + 512, py + 512)) {
      if (px < g.minX || px > g.maxX || py < g.minY || py > g.maxY) continue;
      if (pz < g.baseZ) continue;
      return g;
    }
    return null;
  }

  /**
   * Karmi zestaw świateł najbliższymi żagwiami. `LightRig` ma twardy limit
   * (`max`, domyślnie osiem), a `addSource` po cichu zwraca `false` — loch
   * z dziesięcioma żagwiami zgasłby w połowie bez żadnego komunikatu.
   */
  feedLights(rig: LightRig, px: number, py: number): number {
    clearSources(rig);
    const n = this.lights.length;
    if (n === 0) return 0;
    const xm = px * CELL_METERS;
    const ym = py * CELL_METERS;
    const p = wildPack.light;
    let dodane = 0;
    // wybór k najbliższych bez sortowania i bez alokacji: k przebiegów po liście,
    // przy k = 8 i kilkunastu zagwiach to ponizej dwustu operacji na klatke
    const uzyte = this.usedLights;
    for (let i = 0; i < n; i++) uzyte[i] = 0;
    while (dodane < rig.max) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (uzyte[i] === 1) continue;
        const l = this.lights[i]!;
        const d = (l.x - xm) ** 2 + (l.y - ym) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break;
      uzyte[best] = 1;
      const l = this.lights[best]!;
      if (!addSource(rig, l.x, l.y, l.z, p.sourceRadius, p.sourcePower)) break;
      dodane++;
    }
    return dodane;
  }

  private makeGoblin(x: number, y: number, z: number, yaw: number, origin: string): Mob {
    const def = wildCreatures[0];
    if (def === undefined) throw new Error('paczka bez potworów');
    const actor = makeActor(def.hp, def.stamina, def.attrs, def.skills);
    equipWeapon(actor, def.weapon);
    const being = makeBeing(actor, x, y, z, yaw, 0, def.walkMps, def.runMps);
    return { being, intent: makeIntent(), origin, flashMs: 0 };
  }

  /**
   * Jeden krok symulacji dla wszystkich bytów: światło, AI, ruch, ciosy.
   * Zwraca obrażenia zadane graczowi w tej klatce — pętla gry robi z tego
   * czerwony błysk i sprawdza śmierć.
   */
  step(
    player: Being,
    dtMs: number,
    rig: LightRig,
    rng: () => number,
    out: AttackResult,
    report: MobReport,
  ): void {
    report.damage = 0;
    report.swung = false;
    report.blocked = false;
    report.dodged = false;
    report.missed = false;

    for (const m of this.mobs) {
      const b = m.being;
      if (m.flashMs > 0) m.flashMs -= dtMs;
      if (b.actor.stance === Stance.Dead) {
        animate(b, m.intent, dtMs);
        continue;
      }

      b.lum = this.lumAt(rig, b.x, b.y, b.z);
      updateAi(b, player, this.world, dtMs, rng, m.intent, CELL_METERS);
      this.moveBeing(b, m.intent, dtMs);
      if (serviceSwing(b, player, dtMs, rng, out, CELL_METERS)) {
        report.swung = true;
        report.damage += out.damage;
        if (out.blocked) {
          report.blocked = true;
          // Rozbłysk na sylwetce napastnika, gdy MÓJ blok zatrzymał jego cios.
          // Bez tego udany blok wygląda tak samo jak cudze pudło, a to są dwie
          // różne lekcje dla gracza.
          m.flashMs = FEEDBACK.blockFlashMs;
        } else if (out.dodged) {
          report.dodged = true;
        } else if (!out.landed) {
          report.missed = true;
        }
      }
      animate(b, m.intent, dtMs);
    }
  }

  /**
   * Cios zatrzymany przez przeciwnika: sam rozbłysk, bez klatki `Hit`. Kontakt był,
   * więc coś musi błysnąć — ale bez tej różnicy "zablokował" i "spudłowałeś"
   * dają ten sam obraz i różnią się wyłącznie tekstem w dzienniku.
   */
  markBlocked(m: Mob): void {
    m.flashMs = FEEDBACK.blockFlashMs;
  }

  /** Zaznacza trafienie bytu: klatka `Hit` na chwilę plus rozbłysk. */
  markHit(m: Mob): void {
    m.flashMs = FEEDBACK.hitFlashMs;
    m.being.holdMs = FEEDBACK.hitHoldMs;
    m.being.frame = Frame.Hit;
  }

  /** Jasność, jaką renderer namaluje w tym miejscu — razem z pochodnią gracza. */
  lumAt(rig: LightRig, x: number, y: number, z: number): number {
    const raw = this.world.light(Math.floor(x), Math.floor(y));
    const surface = raw >> 4 === 0 ? raw & 15 : raw >> 4;
    return lightAt(rig, x * CELL_METERS, y * CELL_METERS, z + EYE_M, surface, raw & 15);
  }

  /**
   * Przesunięcie bytu z tą samą kolizją co gracz: próg, ściana, głębina.
   * Osobno w X i Y, żeby potwór ślizgał się po ścianie zamiast się w niej kleić.
   */
  private moveBeing(b: Being, intent: Intent, dtMs: number): void {
    if (intent.vx === 0 && intent.vy === 0) return;
    const dt = dtMs / 1000;
    this.tryStep(b, b.x + intent.vx * dt, b.y);
    this.tryStep(b, b.x, b.y + intent.vy * dt);
  }

  private tryStep(b: Being, nx: number, ny: number): void {
    const cx = Math.floor(nx);
    const cy = Math.floor(ny);
    const surf = this.world.surfaceHeight(cx, cy, b.z + 0.6);
    if (!Number.isFinite(surf)) return;
    if (this.world.blocks(cx, cy, surf + 0.05, surf + 1.6)) return;
    const water = this.world.waterLevel(cx, cy);
    if (water !== null && water - surf > 1) return;
    b.x = nx;
    b.y = ny;
    b.z = surf;
  }

  /**
   * Lista sprite'ów do narysowania w tej klatce. Bufor jest trzymany między
   * klatkami i tylko nadpisywany — pętla renderu nie alokuje.
   */
  spriteList(): SpriteInstance[] {
    this.sprites.length = 0;
    for (const m of this.mobs) {
      const b = m.being;
      const f = frames[b.kind];
      if (f === undefined) continue;
      if (m.flashMs > 0) {
        // Błysk to podmiana barwy w stronę bieli, nie podbicie luminancji:
        // luminancja powyżej jedynki jest przycinana i byt gubi barwę.
        const k = FEEDBACK.hitFlashMix;
        this.sprites.push({
          x: b.x,
          y: b.y,
          baseZ: b.z,
          yaw: b.yaw,
          frame: b.frame,
          lum: b.lum,
          r: f.r + (255 - f.r) * k,
          g: f.g + (255 - f.g) * k,
          b: f.b + (255 - f.b) * k,
          frames: f,
        });
      } else {
        this.sprites.push({
          x: b.x,
          y: b.y,
          baseZ: b.z,
          yaw: b.yaw,
          frame: b.frame,
          lum: b.lum,
          frames: f,
        });
      }
    }
    return this.sprites;
  }

  /** Byty do zapisu: tylko to, czego świat nie odtworzy z seeda. */
  toSave(): EntitySave[] {
    const out: EntitySave[] = [];
    for (const m of this.mobs) {
      const b = m.being;
      out.push({
        kind: b.kind,
        x: b.x,
        y: b.y,
        z: b.z,
        yaw: b.yaw,
        hp: b.actor.hp,
        ai: b.ai,
        origin: m.origin,
      });
    }
    return out;
  }

  /**
   * Przywraca byty z zapisu i **oznacza ich klastry jako rozpatrzone**. Bez tego
   * kroku pierwsze `spawnAround` po wczytaniu dorzuciłoby drugi komplet goblinów
   * do tych, które właśnie wróciły z pliku — łącznie z tymi, które gracz zabił.
   *
   * Klaster odtwarzamy z pozycji bytu, a nie z zapisu: byt, który odbiegł od swojego
   * klastra, zostawia go nieoznaczonym i wtedy klaster odradza się przy wczytaniu.
   * To jest znany dług, opisany w §10.6 architektury.
   */
  restore(list: readonly EntitySave[]): void {
    this.mobs.length = 0;
    this.lochId = -1;
    for (const e of list) {
      const m = this.makeGoblin(e.x, e.y, e.z, e.yaw, e.origin);
      m.being.actor.hp = e.hp;
      if (e.hp <= 0) m.being.actor.stance = Stance.Dead;
      m.being.ai = e.ai as AiState;
      this.mobs.push(m);
      // Pochodzenie idzie z zapisu, a nie z pozycji: byt, który wyszedł ze swojej
      // komory za graczem, inaczej odrodziłby ją po wczytaniu (dług 10.6).
      if (e.origin !== '') this.seen.add(e.origin);
    }
  }

  /** Żywy byt najbliżej gracza — HUD pokazuje, na co właśnie patrzymy. */
  nearest(px: number, py: number): Mob | null {
    let best: Mob | null = null;
    let bestD = Infinity;
    for (const m of this.mobs) {
      if (m.being.actor.stance === Stance.Dead) continue;
      const d = (m.being.x - px) ** 2 + (m.being.y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }
}

/**
 * Wybór klatki animacji. Stan bytu ma pierwszeństwo nad ruchem: zamach widać
 * nawet wtedy, gdy potwór jednocześnie biegnie, bo to zamach jest informacją,
 * na której gracz opiera decyzję.
 */
export function animate(b: Being, intent: Intent, dtMs: number): void {
  const st = b.actor.stance;
  if (st === Stance.Dead) {
    b.frame = Frame.Death;
    b.holdMs = 0;
    return;
  }
  // Klatka wymuszona zdarzeniem trzyma się przez zadany czas i wygrywa z ruchem:
  // trafienie ma być widoczne nawet wtedy, gdy byt zaraz potem biegnie dalej.
  if (b.holdMs > 0) {
    b.holdMs -= dtMs;
    return;
  }
  if (st === Stance.Windup) {
    b.frame = Frame.Attack;
    return;
  }
  if (st === Stance.Stagger) {
    b.frame = Frame.Hit;
    return;
  }
  if (intent.vx === 0 && intent.vy === 0) {
    b.frame = Frame.Idle;
    return;
  }
  b.frameMs += dtMs;
  // dwie klatki chodu na sekundę marszu; szybciej wygląda jak drganie
  if (b.frameMs > 250) {
    b.frameMs = 0;
    b.frame = b.frame === Frame.Walk0 ? Frame.Walk1 : Frame.Walk0;
  } else if (b.frame !== Frame.Walk0 && b.frame !== Frame.Walk1) {
    b.frame = Frame.Walk0;
  }
}

/** Nazwa stanu AI po polsku — do HUD-u, bo liczba nic nie mówi przy testowaniu. */
export function aiLabel(state: AiState): string {
  switch (state) {
    case AiState.Idle:
      return 'spokój';
    case AiState.Suspicious:
      return 'nasłuchuje';
    case AiState.Hunting:
      return 'ściga';
    case AiState.Fighting:
      return 'walczy';
    default:
      return 'ucieka';
  }
}
