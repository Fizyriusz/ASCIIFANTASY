/**
 * Światło jako mechanika, nie jako efekt.
 *
 * Luminancja steruje **doborem rampy znaku**, a nie tylko jasnością koloru —
 * w lochu bez źródła gracz ma widzieć dosłownie nic poza zasięgiem pochodni.
 * To jest cała mechanika eksploracji podziemi i dlatego `ambient` w nocy oraz
 * pod ziemią wynosi zero. „Minimalne oświetlenie otoczenia dla wygody" kasuje
 * tę mechanikę w całości i jest wprost zakazane w zleceniu M2.
 *
 * Model jest analityczny, nie geometryczny: liczymy **tłumienie z odległości**,
 * nie rzucanie cieni. Ściana nie zasłania światła — to świadome uproszczenie,
 * bo cień wymagałby drugiego marszu na źródło i na komórkę znakową się nie zwraca.
 *
 * Zestaw źródeł jest prealokowany i płaski (`Float64Array`), bo `lightAt` woła się
 * raz na zamalowaną komórkę: przy 7 tysiącach komórek i ośmiu źródłach to 56 tysięcy
 * wyliczeń tłumienia na klatkę i nie ma tam miejsca na alokacje ani na obiekty.
 */

/** Ile liczb opisuje jedno źródło: x, y, z, promień, moc. */
const STRIDE = 5;

export interface LightRig {
  /** źródła statyczne w metrach świata, po `STRIDE` liczb każde */
  readonly sources: Float64Array;
  count: number;
  readonly max: number;
  /**
   * 0..1 — kontrast światła dziennego: ile jasności ma komórka całkiem zacieniona
   * względem odsłoniętej. To jest ta sama liczba co `ambient` w M1.
   */
  ambient: number;
  /**
   * 0..1 — pora dnia jako **mnożnik** całego światła dziennego. Jedynka to
   * południe i zarazem stan sprzed M2, zero to noc: wtedy widać wyłącznie to,
   * co świeci samo.
   */
  daylight: number;
  /** pochodnia gracza: pozycja w metrach świata */
  torchX: number;
  torchY: number;
  torchZ: number;
  torchRadius: number;
  /** 0..1 — moc u źródła; zero wyłącza pochodnię */
  torchPower: number;
  /** 0..1 — chwilowe migotanie, mnożnik mocy; 1 = spokojny płomień */
  torchFlicker: number;
}

export function createLightRig(max = 8): LightRig {
  return {
    sources: new Float64Array(max * STRIDE),
    count: 0,
    max,
    ambient: 0.3,
    daylight: 1,
    torchX: 0,
    torchY: 0,
    torchZ: 0,
    torchRadius: 8,
    torchPower: 0,
    torchFlicker: 1,
  };
}

export function clearSources(rig: LightRig): void {
  rig.count = 0;
}

/**
 * Dokłada źródło. Zwraca `false`, gdy zestaw jest pełny — wołający decyduje,
 * co z tym zrobić; renderer nigdy nie rośnie w trakcie klatki.
 */
export function addSource(
  rig: LightRig,
  x: number,
  y: number,
  z: number,
  radius: number,
  power: number,
): boolean {
  if (rig.count >= rig.max) return false;
  const i = rig.count * STRIDE;
  rig.sources[i] = x;
  rig.sources[i + 1] = y;
  rig.sources[i + 2] = z;
  rig.sources[i + 3] = radius;
  rig.sources[i + 4] = power;
  rig.count++;
  return true;
}

/**
 * Tłumienie kwadratowe bez pierwiastka: `(1 - d²/r²)²`.
 * Brak `Math.sqrt` jest tu istotny — ta funkcja wykonuje się dziesiątki tysięcy
 * razy na klatkę, a kształt krzywej i tak dobieramy na oko, nie z fizyki.
 */
function falloff(dx: number, dy: number, dz: number, radius: number): number {
  const d2 = dx * dx + dy * dy + dz * dz;
  const r2 = radius * radius;
  if (d2 >= r2) return 0;
  const t = 1 - d2 / r2;
  return t * t;
}

/**
 * Luminancja 0..1 w punkcie świata.
 *
 * Dwa światła statyczne, nie jedno, i wchodzą w różny sposób:
 *
 * - `staticLight` (0..15) to **jasność powierzchni**: pora dnia i cień koron.
 *   Wchodzi addytywnie, dokładnie wzorem sprzed M2.
 * - `skyAccess` (0..15) to **dostęp do nieba**: ile światła dziennego dociera
 *   w to miejsce korytarzem albo drzwiami. Wchodzi **mnożąco**, bo pod ziemią
 *   ma zerować całe światło dnia, a nie dodawać się do niego.
 * - `rig.daylight` to pora dnia i też jest mnożnikiem, z tego samego powodu:
 *   noc gasi światło dnia, a nie dosypuje ciemności. Gdyby była składnikiem,
 *   „noc" znaczyłaby tylko „mniejszy kontrast" i pustkowie o północy świeciłoby
 *   pełną jasnością trawy.
 *
 * Na otwartym terenie `skyAccess` wynosi 15 i wzór sprowadza się bajt w bajt
 * do wersji z M1 — dlatego złote pliki M0 i M1 się nie ruszyły. W lochu wynosi
 * zero i wtedy widać wyłącznie to, co świeci: pochodnię i żagwie. Gdyby dostęp
 * do nieba wchodził addytywnie, jaskinia oglądana z zewnątrz w południe byłaby
 * jasna, bo `ambient` należy do obserwatora, a nie do miejsca.
 */
export function lightAt(
  rig: LightRig,
  wx: number,
  wy: number,
  wz: number,
  staticLight: number,
  skyAccess: number,
): number {
  let l = staticLum(rig, staticLight, skyAccess);

  const n = rig.count * STRIDE;
  const src = rig.sources;
  for (let i = 0; i < n; i += STRIDE) {
    const f = falloff(
      wx - (src[i] ?? 0),
      wy - (src[i + 1] ?? 0),
      wz - (src[i + 2] ?? 0),
      src[i + 3] ?? 1,
    );
    if (f > 0) l += f * (src[i + 4] ?? 0);
  }

  if (rig.torchPower > 0) {
    const f = falloff(wx - rig.torchX, wy - rig.torchY, wz - rig.torchZ, rig.torchRadius);
    if (f > 0) l += f * rig.torchPower * rig.torchFlicker;
  }

  return l > 1 ? 1 : l;
}

/**
 * Część światła **niezależna od położenia**: pora dnia, jasność powierzchni
 * i dostęp do nieba. W obrębie jednej komórki jest stała, więc renderer liczy
 * ją raz na komórkę i pomija `lightAt` w pętli wierszy, kiedy w scenie nie ma
 * ani jednego źródła ani pochodni. Wzór jest tu jeden — `lightAt` woła to samo.
 */
export function staticLum(rig: LightRig, staticLight: number, skyAccess: number): number {
  return (
    (rig.ambient + (1 - rig.ambient) * staticLight * 0.0666666666666667) *
    rig.daylight *
    skyAccess *
    0.0666666666666667
  );
}

/**
 * Czy w zestawie jest cokolwiek zależnego od położenia. Fałsz znaczy, że całe
 * światło da się policzyć raz na komórkę.
 */
export function hasPositional(rig: LightRig): boolean {
  return rig.count > 0 || rig.torchPower > 0;
}

/**
 * Migotanie pochodni: sinus o dwóch okresach plus szum z zegara.
 * Trzymane osobno od `lightAt`, bo zależy od czasu — a `lightAt` musi zostać
 * czystą funkcją, inaczej snapshoty przestałyby być powtarzalne.
 */
export function torchFlicker(timeSeconds: number): number {
  const a = Math.sin(timeSeconds * 11.3);
  const b = Math.sin(timeSeconds * 27.7);
  return 0.88 + 0.08 * a + 0.04 * b;
}
