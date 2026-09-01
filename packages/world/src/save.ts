/**
 * Zapis gry: **seed plus nadpisania**, nigdy wygenerowany świat.
 *
 * Świat jest funkcją `(seed, współrzędne)`, więc jedyne, czego nie da się odtworzyć,
 * to zmiany wprowadzone przez gracza. Serializacja chunków dałaby setki megabajtów
 * i koniec projektu — limit 2 MB po 200 godzinach jest w CLAUDE.md i jest twardy.
 *
 * Format na dysku jest **krotkowy, nie obiektowy**: span zapisuje się jako
 * `[bottom, top, mat, capMat, flags]`, a nie jako obiekt z pięcioma nazwami pól.
 * Nazwy pól powtórzone przy każdym spanie kosztują więcej niż same liczby: przy
 * 11 990 deltach z syntetycznych 200 godzin gry wychodzi 483 kB zamiast 1319 kB,
 * czyli 41 bajtów na deltę zamiast 113 (pomiar w `save.test.ts`).
 */

import { CHUNK_SIZE } from './types.js';
import { MAX_SPANS_PER_CELL } from './grid.js';
import type { Cell, DeltaKey, SaveFile, Span } from './types.js';

/** Podbijamy przy każdej niezgodnej zmianie formatu. Stare zapisy odrzucamy wprost. */
export const SAVE_VERSION = 2;

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

export interface GameSave extends SaveFile {
  player: PlayerSave;
  entities: EntitySave[];
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

  return {
    version: SAVE_VERSION,
    seed: w.seed,
    clock: w.clock,
    cellDeltas,
    flags,
    player: w.p,
    entities,
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
