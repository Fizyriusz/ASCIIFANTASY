/**
 * Percepcja: stożek widzenia, linia wzroku po siatce i **poziom światła celu**.
 *
 * Trzeci składnik jest tym, co odróżnia to od zwykłego raycastu do gracza: światło
 * policzyliśmy w M2, więc skradanie w ciemności działa samo, bez osobnego systemu
 * ukrycia. Goblin w oświetlonej komnacie widzi na czterdzieści metrów; ten sam
 * goblin patrzący w ciemny korytarz nie widzi nikogo dwa metry przed sobą.
 *
 * Hałas jest osobnym kanałem i celowo nie zależy od światła — biegnącego gracza
 * słychać w ciemności tak samo jak w dzień, i to jest jedyny powód, dla którego
 * skradanie w ogóle jest decyzją, a nie darmową przewagą.
 */

import { PERCEPTION } from '@rpg/content';
import type { Being } from './being.js';
import { Stance } from './actor.js';

/**
 * Tyle świata potrzebuje percepcja. Strukturalnie pasuje tu i `SpanGrid`,
 * i `ChunkStore` — reguły nie importują `@rpg/world`, żeby nie odwracać kierunku
 * zależności z CLAUDE.md.
 */
export interface SightGrid {
  /** czy w komórce jest bryła przecinająca przedział wysokości [z0, z1] */
  blocks(cx: number, cy: number, z0: number, z1: number): boolean;
  /** bajt światła: górne cztery bity to jasność powierzchni, dolne dostęp do nieba */
  light(cx: number, cy: number): number;
}

/**
 * Jasność powierzchni komórki w skali 0..1. Czyta bajt światła tą samą regułą co
 * renderer: górna połówka, a gdy jest zerowa — dolna, bo paczki oparte na `SpanGrid`
 * trzymają światło jako czystą wartość 0..15. Rozjazd z rendererem znaczyłby, że AI
 * widzi coś innego niż gracz, a to jest najgorszy rodzaj błędu w skradaniu.
 */
export function cellLight(grid: SightGrid, x: number, y: number): number {
  const raw = grid.light(Math.floor(x), Math.floor(y));
  const surface = raw >> 4;
  return (surface === 0 ? raw & 15 : surface) / 15;
}

/**
 * Linia wzroku po siatce komórek (DDA), z interpolacją wysokości. Sprawdza przedział
 * wysokości między okiem a celem w każdej mijanej komórce, więc kucnięcie za murkiem
 * naprawdę zasłania, a przęsło mostu nad głową — nie.
 *
 * Metry na komórkę są parametrem, bo `SightGrid` ich nie zna.
 */
export function hasLineOfSight(
  grid: SightGrid,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  metersPerCell: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return true;
  // krok co pół komórki: mniej gubi cienkie ściany, więcej kosztuje w pętli AI
  const steps = Math.ceil(dist * 2);
  const invSteps = 1 / steps;
  for (let i = 1; i < steps; i++) {
    const t = i * invSteps;
    const cx = Math.floor(x0 + dx * t);
    const cy = Math.floor(y0 + dy * t);
    const z = z0 + (z1 - z0) * t;
    // wąski przedział wokół promienia: sprawdzamy, czy bryła przecina samą linię
    if (grid.blocks(cx, cy, z - 0.05 * metersPerCell, z + 0.05 * metersPerCell)) return false;
  }
  return true;
}

/**
 * Czy `self` widzi `other`. Kolejność sprawdzeń jest od najtańszego do najdroższego,
 * bo to biegnie dla każdego bytu w każdej klatce: dystans, stożek, światło, dopiero
 * na końcu marsz po siatce.
 */
export function canSee(
  self: Being,
  other: Being,
  grid: SightGrid,
  metersPerCell: number,
  eyeHeightM = 1.5,
): boolean {
  if (self.actor.stance === Stance.Dead) return false;
  const dx = other.x - self.x;
  const dy = other.y - self.y;
  const distM = Math.sqrt(dx * dx + dy * dy) * metersPerCell;

  // z bliska nie trzeba widzieć: słychać oddech i czuć zapach
  const blisko = distM <= PERCEPTION.senseM;

  if (!blisko) {
    const kat = Math.atan2(dy, dx) - self.yaw;
    const norm = Math.atan2(Math.sin(kat), Math.cos(kat));
    if (Math.abs(norm) > PERCEPTION.coneHalf) return false;

    // Światło bierzemy z **bytu**, nie z komórki: gracz z pochodnią świeci sam
    // i ma być widoczny w ciemnym korytarzu, a to jest cena za widzenie czegokolwiek.
    if (other.lum < PERCEPTION.darkCutoff) return false;
    // zasięg skaluje się światłem: w półmroku widać, ale tylko z bliska
    if (distM > PERCEPTION.sightM * other.lum) return false;
  }

  const eyeZ = self.z + eyeHeightM;
  return hasLineOfSight(grid, self.x, self.y, eyeZ, other.x, other.y, other.z + eyeHeightM, metersPerCell);
}

/**
 * Czy `self` słyszy `other`. Ściany nie tłumią — dźwięk niesie się korytarzem, a nie
 * przez skałę, ale modelowanie tego byłoby drugim systemem widoczności dla efektu,
 * którego gracz nie odróżni od zasięgu.
 */
export function canHear(self: Being, other: Being, metersPerCell: number): boolean {
  if (self.actor.stance === Stance.Dead) return false;
  const dx = other.x - self.x;
  const dy = other.y - self.y;
  const distM = Math.sqrt(dx * dx + dy * dy) * metersPerCell;
  return distM <= (other.running ? PERCEPTION.noiseRunM : PERCEPTION.noiseSneakM);
}
