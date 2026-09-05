/**
 * Zapis gry: **seed plus nadpisania**, nigdy wygenerowany świat.
 *
 * Świat jest funkcją `(seed, współrzędne)`, więc jedyne, czego nie da się odtworzyć,
 * to zmiany wprowadzone przez gracza. Serializacja chunków dałaby setki megabajtów
 * i koniec projektu — limit 2 MB po 200 godzinach jest w CLAUDE.md i jest twardy.
 *
 * Format na dysku jest **krotkowy, nie obiektowy**: span zapisuje się jako
 * `[bottom, top, mat, capMat, flags]`, a nie jako obiekt z pięcioma nazwami pól.
 * Nazwy pól powtórzone przy każdym wpisie kosztują więcej niż same liczby: przy
 * 11 990 deltach komórek i 12 000 delt bytów z syntetycznych 200 godzin gry wychodzi
 * 832 kB zamiast 2697 kB (pomiar w `save.test.ts`). Bez tego samo dołożenie delt bytów
 * w M3e zjadałoby 1,4 MB z twardego limitu 2 MB.
 */

import { CHUNK_SIZE } from './types.js';
import { MAX_SPANS_PER_CELL } from './grid.js';
import type { Cell, DeltaKey, SaveFile, Span } from './types.js';

/** Podbijamy przy każdej niezgodnej zmianie formatu. Stare zapisy odrzucamy wprost. */
export const SAVE_VERSION = 4;

/** Span w postaci krotki — tak leży w pliku zapisu. */
type SpanTuple = [number, number, number, number, number];

/** Delta komórki: krotki spanów i światło. `null` w miejscu spanów = bez zmian. */
type CellDelta = [SpanTuple[] | null, number | null];

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  attrs: number[];
  skills: number[];
  /** ułamkowy postęp umiejętności — bez niego wczytanie cofa naukę o kilka godzin */
  progress: number[];
  weapon: number | null;
  armor: number | null;
  weaponWear: number;
  armorWear: number;
  /** plecak: pary [rodzaj, indeks] */
  items: [number, number][];
}

/**
 * Byt w zapisie. Potwory są proceduralne, więc zapisujemy tylko to, co odbiega od
 * tego, co wygeneruje świat: gdzie stoi, ile mu zostało i co robi.
 */
export interface EntitySave {
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  ai: number;
  /**
   * Skąd byt pochodzi: `"kx:ky"` dla klastra powierzchni, `"poi:komora"` dla lochu.
   *
   * Do wersji 1 zapisu pochodzenie odtwarzało się z **pozycji**, co działało tylko
   * dopóki byt stał tam, gdzie się urodził. Mieszkaniec lochu, który wyszedł za
   * graczem do korytarza, po wczytaniu odradzał swoją komorę — bo z jego pozycji
   * nie dało się już odczytać, że ta komora jest już obsadzona. To jest dług 10.6
   * z architektury i tu zostaje spłacony.
   */
  origin: string;
}

/**
 * Co gracz zmienił w bycie, którego już nie ma w symulacji. Byty powstają z seeda,
 * więc zapisujemy **wyłącznie odstępstwa**: zabity zostaje zabity, ranny wraca ranny,
 * a byt nietknięty nie zostawia śladu i przy powrocie odtworzy się identyczny.
 *
 * To jest ta sama zasada, co przy świecie (seed plus delty komórek) — i ten sam
 * powód: dziennik wszystkich minięć rósłby bez ograniczeń wraz ze zwiedzonym terenem.
 */
export interface EntityDelta {
  /** pochodzenie bytu: `"kx:ky#i"` na powierzchni, `"poi:komora#i"` w lochu */
  origin: string;
  dead: boolean;
  hp: number;
  /** pozycja w chwili zwolnienia; przy zabitym jest to miejsce upadku ciała */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /**
   * minuta zegara gry, w której byt zginął, albo `-1`, gdy zwłoki już wygasły.
   * Bez tego pola nie da się odtworzyć ciała przy powrocie — a to jest dokładnie
   * ten brak, przez który zabity goblin wyglądał, jakby świat zjadał zwłoki.
   */
  diedAtMin: number;
}

/**
 * Delta bytu w pliku, w trzech dlugosciach:
 *
 * - `[pochodzenie]` — zabity, po ktorym nie ma juz zwlok; pozycja jest nieistotna,
 * - `[pochodzenie, hp, x, y, z, yaw]` — ranny albo przesuniety,
 * - `[pochodzenie, 0, x, y, z, yaw, czas smierci]` — zabity, po ktorym **lezy cialo**.
 *
 * Ten sam powod, co przy spanach — nazwy pol powtorzone przy kazdym wpisie kosztuja
 * wiecej niz same liczby, a delt bytow po dlugiej grze jest tyle, co delt komorek:
 * 117 B na obiekt zamiast 40 B na krotke to roznica miedzy 1,9 MB a 1,0 MB przy
 * twardym limicie 2 MB (pomiar w `save.test.ts`).
 *
 * Trzecia postac jest **przejsciowa**: po wygasnieciu zwlok wpis wraca do pierwszej,
 * czyli plac sie tylko za ciala lezace w tej chwili. Zmierzone: swiezy trup kosztuje
 * 43 B zamiast 14 B, a wersja „trup lezy wiecznie" dolozylaby 348 kB na 200 h gry.
 *
 * Pozycje zaokraglamy do centymetra, a zwrot do tysiecznej radiana: rozdzielczosc
 * ponad ta nie jest widoczna w grze, a w pliku kosztuje kilkanascie bajtow na wpis.
 */
type EntityTuple =
  | [string]
  | [string, number, number, number, number, number]
  | [string, number, number, number, number, number, number];

function entityToWire(d: EntityDelta): EntityTuple {
  const x = round2(d.x);
  const y = round2(d.y);
  const z = round2(d.z);
  const yaw = Math.round(d.yaw * 1000) / 1000;
  if (d.dead) {
    return d.diedAtMin < 0 ? [d.origin] : [d.origin, 0, x, y, z, yaw, Math.round(d.diedAtMin)];
  }
  return [d.origin, d.hp, x, y, z, yaw];
}

function entityFromWire(e: unknown): EntityDelta | null {
  if (!Array.isArray(e) || typeof e[0] !== 'string') return null;
  const origin = e[0];
  if (e.length === 1) {
    return { origin, dead: true, hp: 0, x: 0, y: 0, z: 0, yaw: 0, diedAtMin: -1 };
  }
  if (e.length !== 6 && e.length !== 7) return null;
  for (let i = 1; i < e.length; i++) if (typeof e[i] !== 'number') return null;
  const zwloki = e.length === 7;
  return {
    origin,
    dead: zwloki,
    hp: e[1] as number,
    x: e[2] as number,
    y: e[3] as number,
    z: e[4] as number,
    yaw: e[5] as number,
    diedAtMin: zwloki ? (e[6] as number) : -1,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface GameSave extends SaveFile {
  player: PlayerSave;
  /** byty **żywe w chwili zapisu** — te, które akurat są w pierścieniu wokół gracza */
  entities: EntitySave[];
  /** odstępstwa bytów zwolnionych z symulacji */
  entityDeltas: EntityDelta[];
}

/** Minimalny kontrakt `localStorage` — dzięki niemu testy nie potrzebują DOM-u. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Wire {
  v: number;
  seed: number;
  clock: number;
  /** delty jako pary [klucz, delta] — obiekt z dziesięcioma tysiącami pól jest wolny */
  d: [string, CellDelta][];
  f: [string, number][];
  p: PlayerSave;
  e: EntitySave[];
  /** delty bytów — krótka nazwa, bo tego jest najwięcej po długiej grze */
  ed: EntityTuple[];
}

export function serialize(save: GameSave): string {
  const d: [string, CellDelta][] = [];
  for (const key of Object.keys(save.cellDeltas) as DeltaKey[]) {
    const delta = save.cellDeltas[key];
    if (delta === undefined) continue;
    const spans = delta.spans;
    d.push([
      key,
      [
        spans === undefined ? null : spans.map(toTuple),
        delta.light === undefined ? null : delta.light,
      ],
    ]);
  }
  const f: [string, number][] = [];
  for (const key of Object.keys(save.flags)) f.push([key, save.flags[key] ?? 0]);

  const wire: Wire = {
    v: SAVE_VERSION,
    seed: save.seed,
    clock: save.clock,
    d,
    f,
    p: save.player,
    e: save.entities,
    ed: save.entityDeltas.map(entityToWire),
  };
  return JSON.stringify(wire);
}

/**
 * Wczytuje zapis. Zwraca `null` zamiast rzucać, bo źródłem jest `localStorage`
 * albo plik od użytkownika — jedno i drugie może być czymkolwiek, a gra ma wtedy
 * zacząć nową partię, a nie się wywalić.
 */
export function parse(text: string): GameSave | null {
  let wire: unknown;
  try {
    wire = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof wire !== 'object' || wire === null) return null;
  const w = wire as Partial<Wire>;
  if (w.v !== SAVE_VERSION) return null;
  if (typeof w.seed !== 'number' || typeof w.clock !== 'number') return null;
  if (!Array.isArray(w.d) || !Array.isArray(w.f) || !Array.isArray(w.e)) return null;
  if (typeof w.p !== 'object' || w.p === null) return null;

  const cellDeltas: Record<DeltaKey, Partial<Cell>> = {};
  for (const entry of w.d) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [key, delta] = entry;
    if (typeof key !== 'string' || !isDeltaKey(key) || !Array.isArray(delta)) continue;
    const [spans, light] = delta;
    const out: Partial<Cell> = {};
    if (Array.isArray(spans)) out.spans = spans.map(fromTuple).slice(0, MAX_SPANS_PER_CELL);
    if (typeof light === 'number') out.light = light;
    cellDeltas[key] = out;
  }

  const flags: Record<string, number> = {};
  for (const entry of w.f) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
      flags[entry[0]] = entry[1];
    }
  }

  // byty bez pochodzenia (zapis v1) już się nie zdarzą — wersja jest odrzucana
  // wcześniej — ale pole jest opcjonalne w danych, więc uzupełniamy je pustym
  const entities: EntitySave[] = [];
  for (const e of w.e) {
    if (typeof e !== 'object' || e === null) continue;
    entities.push({ ...(e as EntitySave), origin: (e as EntitySave).origin ?? '' });
  }

  const entityDeltas: EntityDelta[] = [];
  if (Array.isArray(w.ed)) {
    for (const e of w.ed) {
      const d = entityFromWire(e);
      if (d !== null) entityDeltas.push(d);
    }
  }

  return {
    version: SAVE_VERSION,
    seed: w.seed,
    clock: w.clock,
    cellDeltas,
    flags,
    player: w.p,
    entities,
    entityDeltas,
  };
}

/**
 * Klucz delty: `chunkX:chunkY:komórka`. Sprawdzamy kształt, bo wczytanie zapisu
 * z uszkodzonym kluczem nadpisałoby przypadkową komórkę zamiast tej właściwej.
 */
function isDeltaKey(key: string): key is DeltaKey {
  const parts = key.split(':');
  if (parts.length !== 3) return false;
  for (const p of parts) {
    if (p === '' || !Number.isInteger(Number(p))) return false;
  }
  const cell = Number(parts[2]);
  return cell >= 0 && cell < CHUNK_SIZE * CHUNK_SIZE;
}

function toTuple(s: Span): SpanTuple {
  return [s.bottom, s.top, s.mat, s.capMat, s.flags];
}

function fromTuple(t: unknown): Span {
  const a = Array.isArray(t) ? t : [];
  return {
    bottom: num(a[0]),
    top: num(a[1]),
    mat: num(a[2]),
    capMat: num(a[3]),
    flags: num(a[4]),
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const KEY = 'ascii-rpg-save';

/** Zapis do przeglądarki. Zwraca `false`, gdy się nie zmieścił albo storage odmówił. */
export function saveToStorage(storage: StorageLike, save: GameSave, key = KEY): boolean {
  try {
    storage.setItem(key, serialize(save));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(storage: StorageLike, key = KEY): GameSave | null {
  const text = storage.getItem(key);
  return text === null ? null : parse(text);
}

export function clearStorage(storage: StorageLike, key = KEY): void {
  storage.removeItem(key);
}

/**
 * Rozmiar zapisu w bajtach UTF-8. Wystawione, bo limit 2 MB jest budżetem
 * mierzalnym, a nie deklaracją — gra pokazuje tę liczbę w panelu zapisu.
 */
export function saveSizeBytes(save: GameSave): number {
  const text = serialize(save);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return bytes;
}
