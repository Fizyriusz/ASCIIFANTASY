/**
 * Marsz kolumnowy — serce renderera.
 *
 * Zastępuje parę "DDA + floor-casting" z prototypu jedną pętlą, która obsługuje
 * teren, budynki, mosty i wnętrza. Model: komórka to lista spanów (pionowych brył),
 * render w stylu voxel-space (Comanche) uogólnionym na wiele spanów.
 *
 * Algorytm (pełny opis: docs/architektura.md §3.1):
 *
 *   dla każdej kolumny ekranu:
 *     loRow = rows                       // najwyższy wiersz zamalowany od dołu
 *     hiRow = -1                         // najniższy wiersz zamalowany od góry
 *     DDA po siatce, krok po komórce:
 *       spany "podłogowe" (bottom < eyeZ), od góry:
 *         rowSurf = project(span.top, dist)
 *         jeśli rowSurf >= loRow: pomiń       // zasłonięty przez bliższą geometrię
 *         ściana: rowSurf .. rzut poprzedniej powierzchni    → mat
 *         czapka: reszta paska do loRow-1                    → capMat (floor-cast)
 *         loRow = rowSurf
 *       spany "sufitowe" (bottom >= eyeZ), od dołu — lustrzanie, front hiRow
 *       jeśli hiRow + 1 >= loRow: przerwij kolumnę           // ekran zapełniony
 *
 * Dlaczego dwa fronty, a nie jeden `minRow`: pojedynczy front wypełniany w górę
 * renderuje poprawnie wszystko, na co patrzymy z góry, ale gubi powierzchnie nad
 * okiem — sufit wnętrza i spód mostu. Te dwa przypadki są jedynym powodem, dla
 * którego w ogóle mamy spany zamiast wysokości na komórkę, więc front górny jest
 * wymaganiem, nie ozdobą. Fronty są symetryczne i spotykają się na horyzoncie.
 *
 * Dlaczego near→far z frontem jest poprawne: bliższa geometria ma zawsze niższy
 * dolny wiersz, więc dalsza może być widoczna wyłącznie *powyżej* tego, co już
 * zamalowaliśmy. To pozwala odrzucić zasłonięte spany bez z-bufora.
 *
 * Podział na ścianę i czapkę wynika z *poprzedniej* powierzchni w tej kolumnie,
 * a nie z dolnej krawędzi spanu: pasek między rzutem poprzedniej powierzchni a
 * rzutem bieżącej to pionowa ściana uskoku, wszystko poniżej to płaszczyzna
 * pozioma. Dla płaskiego terenu obie wysokości są równe, ściana znika i zostaje
 * sama czapka — czyli dokładnie to, co widać na ulicy.
 *
 * Jednostki: siatka i odległości DDA są w komórkach, wysokości spanów w metrach.
 * Przelicznik `metersPerCell` siedzi w RenderContext — pomylenie tych jednostek
 * daje budynki dwa razy za wysokie i nie widać tego na małej scenie testowej.
 *
 * ZAKAZ ALOKACJI. Trafienia lądują w prealokowanych tablicach `ColumnHits`.
 */

import type { Screen } from './screen.js';
import type { Material } from './materials.js';
import { materialGlyph } from './materials.js';
import type { LightRig } from './light.js';
import { createLightRig, lightAt, staticLum } from './light.js';
import { pack15, shade } from './color.js';

export interface Camera {
  /** pozycja w komórkach siatki (nie w metrach) */
  x: number;
  y: number;
  /** wysokość oka nad podłożem, w metrach świata */
  eyeZ: number;
  yaw: number;
  pitch: number;
  fov: number;
}

/** Maks. liczba widocznych spanów na kolumnę. Powyżej i tak nic nie widać. */
export const MAX_HITS = 64;

/**
 * Prealokowany zestaw buforów na trafienia jednej kolumny.
 * Struktura tablic równoległych, nie tablica obiektów — 1200 obiektów na klatkę
 * to GC co sekundę, co widzieliśmy w prototypie.
 */
export interface ColumnHits {
  count: number;
  dist: Float64Array;
  topZ: Float64Array;
  bottomZ: Float64Array;
  rowTop: Float64Array;
  rowBot: Float64Array;
  /** ułamek pozycji trafienia wzdłuż ściany, 0..1 — do tekstury */
  wallU: Float64Array;
  /** 0 = ściana prostopadła do X, 1 = do Y. Do cieniowania boków. */
  side: Uint8Array;
  cellIndex: Int32Array;
  spanIndex: Int32Array;
}

export function createColumnHits(): ColumnHits {
  return {
    count: 0,
    dist: new Float64Array(MAX_HITS),
    topZ: new Float64Array(MAX_HITS),
    bottomZ: new Float64Array(MAX_HITS),
    rowTop: new Float64Array(MAX_HITS),
    rowBot: new Float64Array(MAX_HITS),
    wallU: new Float64Array(MAX_HITS),
    side: new Uint8Array(MAX_HITS),
    cellIndex: new Int32Array(MAX_HITS),
    spanIndex: new Int32Array(MAX_HITS),
  };
}

/** Co renderer musi umieć zapytać o świat. Celowo minimalne. */
export interface RenderTarget {
  /** liczba spanów w komórce */
  spanCount(cx: number, cy: number): number;
  /** górna krawędź spanu w metrach */
  spanTop(cx: number, cy: number, i: number): number;
  spanBottom(cx: number, cy: number, i: number): number;
  spanMaterial(cx: number, cy: number, i: number): number;
  spanCapMaterial(cx: number, cy: number, i: number): number;
  /** statyczne światło komórki 0..15 */
  light(cx: number, cy: number): number;
}

/**
 * Stan renderu: dane stałe w klatce plus pola przeliczane raz na klatkę.
 * Trzymamy je w jednym obiekcie, bo `renderColumn` ma ustaloną sygnaturę i nie
 * dostaje projekcji osobnymi argumentami, a liczenie jej per kolumna to 150 razy
 * ta sama trygonometria.
 */
export interface RenderContext {
  materials: readonly Material[];
  /**
   * Czy tablica materiałów zawiera **cokolwiek** przezroczystego. Liczone raz
   * na klatkę, żeby kolumna na otwartym terenie nie przeglądała spanów komórki
   * w poszukiwaniu otworu, którego w tej paczce nie ma. Dwadzieścia porównań
   * na klatkę zamiast półtora na komórkę.
   */
  /**
   * Materiał malowany tam, gdzie promień nie trafił w nic.
   *
   * Niebo jest powierzchnią, nie brakiem powierzchni: bez tego wylot jaskini
   * oglądany z wnętrza jest czarnym prostokątem, którego nie da się odróżnić
   * od ściany, i gracz nie ma po czym trafić do wyjścia. `-1` zostawia kolumny
   * puste — tak zachowywał się renderer do M2 włącznie.
   */
  skyMaterial: number;
  /** bufor trafień, którego renderWorld używa dla kolejnych kolumn */
  hits: ColumnHits;
  /** zasięg marszu w komórkach */
  maxDepth: number;
  /**
   * Twardy limit kroków DDA na kolumnę — bezpiecznik, nie zasięg.
   *
   * Musi wystarczyć na cały zasięg: jeden krok to jedna granica komórki, a promień
   * pod 45° przecina dwie granice na komórkę odległości — stąd `2 * maxDepth`
   * z zapasem. Domyślne 192 przy zasięgu 200 ucinały marsz na 96-140 komórkach
   * i widać to było jako niebo w miejscu dalekiego grzbietu: niezmiennik
   * nadmiarowego nieba wskazał bryły na 273-360 m przy zasięgu 400 m.
   */
  maxSteps: number;
  /** metry na komórkę; siatka jest w komórkach, wysokości spanów w metrach */
  metersPerCell: number;
  /** dystans mgły w metrach */
  fogDist: number;
  /** 0..1 — ile widać w komórce o zerowym świetle statycznym */
  ambient: number;
  /**
   * Źródła światła i pochodnia. `ambient` z tego zestawu nadpisuje pole wyżej —
   * pole zostaje, bo `createRenderContext` przyjmuje je jako opcję.
   */
  light: LightRig;
  /**
   * Maska pokrycia wierszy, prealokowana na maksymalną wysokość ekranu.
   * Od M2c jest jedynym stanem kolumny: każdy wiersz jest albo zamalowany,
   * albo nie, i nie ma drugiej reprezentacji tej samej informacji.
   */
  coverage: Uint8Array;
  /**
   * Opcjonalna mapa „ta komórka to niebo", jedna bajtowa komórka na znak ekranu.
   * `null` w grze; testy podstawiają bufor, bo niezmiennik nadmiarowego nieba musi
   * wiedzieć **dokładnie**, które komórki są niebem. Rozpoznawanie po barwie zawodzi:
   * w ciemnej scenie skała o luminancji 0,09 daje po kwantyzacji tę samą barwę co
   * niebo o 0,06, a po dołożeniu mgły mieszającej się z niebem zawodzi też
   * porównanie z renderem bez nieba.
   */
  skyMask: Uint8Array | null;
  cellW: number;
  cellH: number;
  // --- poniżej: przeliczane przez renderWorld na starcie klatki, renderColumn tylko czyta ---
  kh: number;
  kv: number;
  horizon: number;
  dirX: number;
  dirY: number;
  planeX: number;
  planeY: number;
}

export interface RenderOptions {
  /** indeks materiału nieba w tablicy materiałów; -1 wyłącza malowanie nieba */
  skyMaterial?: number;
  maxDepth?: number;
  maxSteps?: number;
  metersPerCell?: number;
  fogDist?: number;
  ambient?: number;
  cellW?: number;
  cellH?: number;
}

/** Sentynel "brak powierzchni" — rzut wypada poza ekranem, więc pasek wychodzi pusty. */
const NO_SURFACE = 1e6;

/**
 * Stałe mnożniki jasności per **orientacja powierzchni**: podłoga najjaśniejsza,
 * strop najciemniejszy, ściany pośrodku.
 *
 * To nie jest oświetlenie kierunkowe ani udawanie cieni — to najtańsza możliwa
 * poprawa czytelności wnętrz. Bez niej podłoga, ściana i strop z tego samego
 * materiału, oświetlone tą samą pochodnią, dostają niemal identyczną barwę
 * i styk między nimi znika: w komorze lochu **67% styków** dwóch różnych
 * orientacji było nie do odróżnienia (ani inny glif, ani trzy stopnie barwy).
 *
 * Wartości pochodzą z przemiatania, nie z oka. Metryka: udział styków
 * nierozróżnialnych w trzech scenach (tunel z wylotem, komora z żagwiami, izba
 * chaty), przy koszcie liczonym jako ubytek komórek spadających poniżej progu
 * widoczności materiału. Scena rozstrzygająca to izba chaty (225 styków): 38%
 * ślepych przy mnożnikach równych jedynce, 7% po zmianie. Tunel z wylotem miał
 * 0% w obu wariantach — tam rozróżnia odległość. Komorę lochu odrzuciliśmy jako
 * scenę pomiarową, bo ma pięć styków i metryka jest na niej szumem.
 *
 * Spośród kombinacji dających 7% wybrana jest najtańsza: 1,15 / 0,9 / 0,6 gubi
 * 0,1% komórek poniżej progu widoczności, podczas gdy 1,15 / 0,8 / 0,6 gubi 3,6%.
 */
const FACE_FLOOR = 1.15;
const FACE_WALL = 0.9;
const FACE_CEIL = 0.6;
/** ściany prostopadłe do Y wobec prostopadłych do X — rozróżnienie narożnika z M0 */
const FACE_SIDE = 0.8;

/**
 * Skala kratki hasza nieba i jej rzutowany rozmiar.
 *
 * Niebo jest hashowane po **kierunku patrzenia**, nie po pozycji: gwiazda ma stać
 * w miejscu, kiedy gracz idzie, i obracać się razem z kadrem, kiedy się rozgląda.
 * Sześćdziesiątka daje mniej więcej trzy kolumny ekranu na komórkę kratki przy
 * polu widzenia 74° — na tyle rzadko, żeby gwiazdy nie zlewały się w płachtę.
 */
const SKY_SCALE = 200;
const SKY_FOOT = 0.5;

/**
 * Od jakiego dostępu do nieba wolno w ogóle **zastąpić powierzchnię niebem**.
 *
 * Zero nie wystarczy i to był realny błąd: ściana tunelu pięć komórek od wylotu
 * ma dostęp 1, czyli jest prawie czarna — a warunek „większy od zera" zamieniał
 * ją w niebo o pełnej jasności. Efekt: stojąc w tunelu bez pochodni widziało się
 * niebo dookoła zamiast skały. Próg 12 to najgłębsze wcięcie wejściowe
 * (`SKY_MIN` w generatorze), czyli granica między „pod gołym niebem" a „w środku".
 */
const SKY_OPEN = 12;

/**
 * Barwa powierzchni z uwzględnieniem mgły. Zwraca `-1`, gdy komórki nie widać
 * i nie ma jej po co malować.
 *
 * Mgła **zlewa się z niebem, a nie z czernią**: daleki grzbiet w dzień nie wycina
 * w niebie czarnej dziury, tylko blednie. Do M2c robiła to podmiana glifu na niebo
 * przy luminancji poniżej progu — a to znaczyło niebo w miejscu, gdzie stoi bryła,
 * czyli dokładnie to, czego zabrania niezmiennik nadmiarowego nieba. Pod ziemią
 * (`access` poniżej `SKY_OPEN`) mieszania nie ma i ciemność zostaje ciemnością.
 */
function fogShade(
  m: Material,
  lum: number,
  fogT: number,
  skyM: Material | undefined,
  skyLum: number,
  access: number,
): number {
  if (skyM === undefined || access < SKY_OPEN) {
    return lum < m.minLum ? -1 : pack15(m.r * lum, m.g * lum, m.b * lum);
  }
  const haze = (1 - fogT) * skyLum;
  const near = lum * fogT;
  if (near < m.minLum && haze < skyM.minLum) return -1;
  return pack15(
    m.r * near + skyM.r * haze,
    m.g * near + skyM.g * haze,
    m.b * near + skyM.b * haze,
  );
}

/**
 * Jedyne miejsce, w którym zapada decyzja „w tym wierszu widać niebo".
 *
 * Powód istnienia tej funkcji jest historyczny i wart zapamiętania: decyzja była
 * rozsiana po sześciu miejscach w kolumnie i **trzy razy z rzędu okazała się
 * błędna w innym z nich**. Dopóki warunek jest jeden, kolejnego wariantu tego
 * samego objawu nie da się dodać przez nieuwagę.
 *
 * Warunek: materiał nieba istnieje, miejsce ma realny dostęp do nieba
 * (`SKY_OPEN`), a samo niebo jest o tej porze doby widoczne.
 */
function skyIfOpen(
  screen: Screen,
  col: number,
  row: number,
  m: Material | undefined,
  lum: number,
  access: number,
  rdx: number,
  rdy: number,
  horizon: number,
  kv: number,
): boolean {
  if (m === undefined || access < SKY_OPEN || lum < m.minLum) return false;
  skyCell(screen, col, row, m, lum, rdx, rdy, horizon, kv);
  return true;
}

/**
 * Maluje jeden wiersz nieba. Hash idzie po **kierunku patrzenia**, nie po pozycji
 * kamery ani po wierszu ekranu: gwiazda stoi w miejscu, gdy gracz idzie, i obraca
 * się razem z kadrem, gdy się rozgląda.
 */
function skyCell(
  screen: Screen,
  col: number,
  row: number,
  m: Material,
  lum: number,
  rdx: number,
  rdy: number,
  horizon: number,
  kv: number,
): void {
  const elev = (horizon - (row + 0.5)) / kv;
  screen.putUnsafe(
    col,
    row,
    materialGlyph(m, lum, rdx * SKY_SCALE, rdy * SKY_SCALE, elev * SKY_SCALE, SKY_FOOT),
    shade(m.r, m.g, m.b, lum),
  );
}

/**
 * Próg malowania jest **per materiał** (`Material.minLum`), nie globalny.
 *
 * Bez progu „w lochu bez światła nie widać nic" jest niewykonalne: rampa ciemna ma
 * swój glif i przy zerowej luminancji renderer malowałby kropki w idealnej ciemności.
 * Ale próg globalny 0,035 był **poniżej** granicy widoczności kamienia: przy 0,04
 * kolor po kwantyzacji `pack15` wychodzi czarny, więc glif był malowany i niewidoczny
 * naraz. Teraz każdy materiał gaśnie tam, gdzie faktycznie znika jego kolor.
 */

export function createRenderContext(
  materials: readonly Material[],
  opts?: RenderOptions,
): RenderContext {
  const rig = createLightRig();
  rig.ambient = opts?.ambient ?? 0.25;
  return {
    materials,
    skyMaterial: opts?.skyMaterial ?? -1,
    hits: createColumnHits(),
    maxDepth: opts?.maxDepth ?? 96,
    maxSteps: opts?.maxSteps ?? Math.ceil((opts?.maxDepth ?? 96) * 2) + 8,
    metersPerCell: opts?.metersPerCell ?? 2,
    fogDist: opts?.fogDist ?? 90,
    ambient: opts?.ambient ?? 0.25,
    light: rig,
    coverage: new Uint8Array(256),
    skyMask: null,
    cellW: opts?.cellW ?? 6,
    cellH: opts?.cellH ?? 10,
    kh: 0,
    kv: 0,
    horizon: 0,
    dirX: 1,
    dirY: 0,
    planeX: 0,
    planeY: 1,
  };
}

/**
 * Renderuje całą scenę do bufora znaków.
 *
 * `screen.clear()` jest tutaj, a nie w pętli kolumn: kolumna bez trafień ma
 * zostawić czyste tło, a nie zawartość poprzedniej klatki.
 */
export function renderWorld(
  target: RenderTarget,
  cam: Camera,
  screen: Screen,
  ctx: RenderContext,
): void {
  screen.clear();

  const cols = screen.cols;
  const rows = screen.rows;
  const half = Math.tan(cam.fov * 0.5);

  ctx.kh = (cols * 0.5) / half;
  ctx.kv = ctx.kh * (ctx.cellW / ctx.cellH);
  ctx.horizon = rows * 0.5 + Math.tan(cam.pitch) * ctx.kv;
  ctx.dirX = Math.cos(cam.yaw);
  ctx.dirY = Math.sin(cam.yaw);
  ctx.planeX = -ctx.dirY * half;
  ctx.planeY = ctx.dirX * half;

  // maska musi pomiescic caly ekran; realokacja tylko przy zmianie rozmiaru okna
  if (ctx.coverage.length < rows) ctx.coverage = new Uint8Array(rows);
  if (ctx.skyMask !== null) ctx.skyMask.fill(0);

  for (let col = 0; col < cols; col++) {
    renderColumn(target, cam, screen, col, ctx.hits, ctx);
  }
}

/**
 * Renderuje jedną kolumnę ekranu. Hot path: wszystkie zmienne zadeklarowane na
 * górze funkcji, wyłącznie liczby, zero metod tablicowych, zero destrukturyzacji.
 */
export function renderColumn(
  target: RenderTarget,
  cam: Camera,
  screen: Screen,
  col: number,
  hits: ColumnHits,
  ctx: RenderContext,
): void {
  const cols = screen.cols;
  const rows = screen.rows;
  const horizon = ctx.horizon;
  const kv = ctx.kv;
  const kh = ctx.kh;
  const eyeZ = cam.eyeZ;
  const mpc = ctx.metersPerCell;
  const invMpc = 1 / mpc;
  const fogDist = ctx.fogDist;
  const materials = ctx.materials;
  const maxDepthM = ctx.maxDepth * mpc;
  const rig = ctx.light;
  const cover = ctx.coverage;

  // kierunek promienia: dir + plane * x, celowo nieznormalizowany — dzieki temu
  // odleglosc z DDA jest od razu prostopadla i nie ma rybiego oka
  const camPlane = (2 * (col + 0.5)) / cols - 1;
  let rdx = ctx.dirX + ctx.planeX * camPlane;
  let rdy = ctx.dirY + ctx.planeY * camPlane;
  if (rdx > -1e-9 && rdx < 1e-9) rdx = 1e-9;
  if (rdy > -1e-9 && rdy < 1e-9) rdy = 1e-9;

  let mapX = Math.floor(cam.x);
  let mapY = Math.floor(cam.y);
  const ddx = Math.abs(1 / rdx);
  const ddy = Math.abs(1 / rdy);
  let stepX = 1;
  let stepY = 1;
  let sdx = 0;
  let sdy = 0;
  if (rdx < 0) {
    stepX = -1;
    sdx = (cam.x - mapX) * ddx;
  } else {
    stepX = 1;
    sdx = (mapX + 1 - cam.x) * ddx;
  }
  if (rdy < 0) {
    stepY = -1;
    sdy = (cam.y - mapY) * ddy;
  } else {
    stepY = 1;
    sdy = (mapY + 1 - cam.y) * ddy;
  }

  /**
   * Jedyny stan kolumny: maska pokrycia. Od M2c nie ma frontów loRow/hiRow ani
   * „poprzedniej powierzchni" — każdy wiersz jest albo zamalowany, albo nie.
   *
   * Dwa fronty były optymalizacją z M0 dla świata bez otworów i brył wiszących.
   * Odkąd świat ma jedno i drugie, opisywały coraz węższy przypadek za cenę
   * drugiej implementacji tej samej specyfikacji — a trzy rundy poprawek z M2b
   * poszły na to, że obie implementacje się rozjeżdżały.
   */
  let coveredCount = 0;
  /**
   * Okno wierszy, w którym maska ma jeszcze cokolwiek do zrobienia. Zawęża zakres
   * malowania i odtwarza to, co w dwóch frontach robiło odsiewanie zasłoniętych
   * spanów — ale jest optymalizacją **jednej** ścieżki, a nie drugim opisem
   * pokrycia: wynika z `cover`, nie żyje obok niego.
   */
  let maskTop = 0;
  let maskBot = rows - 1;
  for (let r = 0; r < rows; r++) cover[r] = 0;

  let side = 0;
  let dEnter = 0;
  let dExit = 0;
  let dEnterM = 0;
  let dExitM = 0;
  let invEnterM = 0;
  let fog = 0;
  let face = 1;
  let rawLight = 0;
  let surfaceLight = 0;
  let underLight = 0;
  let faceAccess = 0;
  let capAccess = 0;
  /** dostęp do nieba komórki z poprzedniego kroku DDA */
  let carryAccess = 0;
  let prevUnder = 0;
  let pn = 0;
  let roofed = 0;
  let uWorld = 0;
  let uFrac = 0;
  let uMetres = 0;
  let wallAxisM = 0;
  let wallFoot = 0;
  let capFoot = 0;
  let hitXm = 0;
  let hitYm = 0;
  let n = 0;
  let i = 0;
  let top = 0;
  let bottom = 0;
  let rFirst = 0;
  let rLast = 0;
  let r0 = 0;
  let r1 = 0;
  let row = 0;
  let capMat = 0;
  let matId = 0;
  let k = 0;
  let den = 0;
  let dCapM = 0;
  let dCapCells = 0;
  let zRow = 0;
  let lum = 0;
  let capXm = 0;
  let capYm = 0;
  let planeH = 0;
  let packed = 0;
  let capFog = 0;
  let skyM: Material | undefined;
  let skyLum = 0;
  let wallM: Material | undefined;
  let capM: Material | undefined;

  hits.count = 0;

  // Niebo jest w nieskończoności: bez mgły, bez tłumienia odległością, z pełnym
  // dostępem do nieba. Pora doby wchodzi tą samą funkcją co dla powierzchni.
  skyM = ctx.skyMaterial >= 0 ? materials[ctx.skyMaterial] : undefined;
  skyLum = staticLum(rig, 15, 15);
  if (skyM !== undefined && skyM.emissive > 0) skyLum += (1 - skyLum) * skyM.emissive;

  // Dostęp do nieba komórki kamery — jedyny odczyt „wstecz" w całym marszu.
  carryAccess = 15;
  pn = target.spanCount(mapX, mapY);
  if (pn > 0) {
    prevUnder = target.light(mapX, mapY);
    prevUnder = prevUnder >> 4 === 0 ? 15 : prevUnder & 15;
    if (prevUnder < 15 && eyeZ < target.spanTop(mapX, mapY, pn - 1) - 0.5) {
      carryAccess = prevUnder;
    }
  }

  // Komórkę kamery wchodzimy na dystansie zero i wychodzimy na pierwszej granicy.
  // Bez niej grunt pod nogami nie miałby czym się namalować — do M2b robił to
  // `seedFrontiers`, teraz jest zwykłym pierwszym krokiem marszu.
  dEnter = 0;
  dExit = sdx < sdy ? sdx : sdy;

  for (let step = 0; step <= ctx.maxSteps; step++) {
    n = target.spanCount(mapX, mapY);
    if (n > 0) {
      dEnterM = dEnter * mpc;
      dExitM = dExit * mpc;
      if (dEnterM < 1e-6) dEnterM = 1e-6;
      invEnterM = 1 / dEnterM;
      fog = Math.exp(-dEnterM / fogDist);
      // ×0,8 dla ścian prostopadłych do Y zostaje z M0: rozróżnienie dwóch
      // orientacji pionowych, niezależne od podziału podłoga/ściana/strop
      face = (side === 1 ? FACE_SIDE : 1) * FACE_WALL;

      rawLight = target.light(mapX, mapY);
      // starsza połówka bajtu to jasność powierzchni, młodsza — dostęp do nieba;
      // siatka sprzed M2 trzyma czystą wartość 0..15 i wtedy dostęp jest pełny
      surfaceLight = rawLight >> 4;
      if (surfaceLight === 0) {
        surfaceLight = rawLight & 15;
        underLight = 15;
      } else {
        underLight = rawLight & 15;
      }
      faceAccess = carryAccess;

      hitXm = (cam.x + rdx * dEnter) * mpc;
      hitYm = (cam.y + rdy * dEnter) * mpc;
      uWorld = side === 0 ? cam.y + dEnter * rdy : cam.x + dEnter * rdx;
      uFrac = uWorld - Math.floor(uWorld);
      uMetres = uWorld * mpc;
      wallAxisM = (side === 0 ? mapX : mapY) * mpc;
      wallFoot = dEnterM / kv;

      for (i = 0; i < n; i++) {
        matId = target.spanMaterial(mapX, mapY, i);
        wallM = materials[matId];
        // span przezroczysty to otwór: nie maluje się i niczego nie zasłania
        if (wallM === undefined || wallM.transparent) continue;
        bottom = target.spanBottom(mapX, mapY, i);
        top = target.spanTop(mapX, mapY, i);

        // --- lico boczne: pionowa ściana bryły, widziana z odległości wejścia ---
        //
        // Malujemy **całe** lico, od szczytu po spód, a o tym, co z niego widać,
        // decyduje maska. Do M2b zakres liczyło się od „poprzedniej powierzchni
        // w kolumnie", żeby uskok terenu dostał lico grubości uskoku — to samo
        // wychodzi z maski za darmo, bo dolna część lica jest już przykryta
        // czapką bliższej komórki.
        if (step > 0) {
          rFirst = Math.ceil(horizon - (top - eyeZ) * kv * invEnterM - 0.5);
          rLast = Math.ceil(horizon - (bottom - eyeZ) * kv * invEnterM - 0.5) - 1;
          // Bryła cieńsza niż wiersz i tak zasłania ten wiersz w większości —
          // bez tego minimum daleki grzbiet gubi się między zaokrągleniami
          // i zostaje po nim niebo. Maska pilnuje, żeby wiersz wziął najbliższy.
          if (rLast < rFirst) rLast = rFirst;
          r0 = rFirst < maskTop ? maskTop : rFirst;
          r1 = rLast > maskBot ? maskBot : rLast;
          for (row = r0; row <= r1; row++) {
            if (cover[row] === 1) continue;
            cover[row] = 1;
            coveredCount++;
            zRow = eyeZ + ((horizon - (row + 0.5)) * dEnterM) / kv;
            lum = lightAt(rig, hitXm, hitYm, zRow, surfaceLight, faceAccess) * face;
            if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
            packed = fogShade(wallM, lum, fog, skyM, skyLum, faceAccess);
            if (packed < 0) continue;
            screen.putUnsafe(
              col,
              row,
              materialGlyph(wallM, lum * fog, uMetres, zRow, wallAxisM, wallFoot),
              packed,
            );
          }

          while (maskTop <= maskBot && cover[maskTop] === 1) maskTop++;
          while (maskBot >= maskTop && cover[maskBot] === 1) maskBot--;

          k = hits.count;
          if (k < MAX_HITS) {
            hits.dist[k] = dEnterM;
            hits.topZ[k] = top;
            hits.bottomZ[k] = bottom;
            hits.rowTop[k] = rFirst;
            hits.rowBot[k] = rLast;
            hits.wallU[k] = uFrac;
            hits.side[k] = side;
            hits.cellIndex[k] = ((mapY & 0xffff) << 16) | (mapX & 0xffff);
            hits.spanIndex[k] = i;
            hits.count = k + 1;
          }
        }

        // --- czapka: poziomy szczyt bryły, widoczny, gdy oko jest wyżej ---
        //
        // Płaszczyzna należy do **tej komórki** i jest malowana wyłącznie
        // w wierszach, których rzut wypada na odcinku promienia wewnątrz niej,
        // czyli między dystansem wejścia a wyjścia.
        if (eyeZ > top) {
          capMat = target.spanCapMaterial(mapX, mapY, i);
          capM = materials[capMat];
          if (capM !== undefined) {
            // czapka pod stropem widzi tyle nieba, ile przepuszcza pustka nad nią
            roofed = i + 1 < n && target.spanBottom(mapX, mapY, i + 1) - top > 0.5 ? 1 : 0;
            capAccess = roofed === 1 ? underLight : 15;
            planeH = (eyeZ - top) * kv;
            // dalszy koniec pasa; na końcu zasięgu ciągniemy go do horyzontu,
            // inaczej między ostatnią komórką a niebem zostaje pusty pasek
            r0 =
              dExitM >= maxDepthM
                ? Math.ceil(horizon - 0.5)
                : Math.ceil(horizon + planeH / dExitM - 0.5);
            r1 = Math.ceil(horizon + planeH / dEnterM - 0.5) - 1;
            // pas cieńszy niż wiersz nadal zasłania jeden wiersz — inaczej przy
            // horyzoncie zostają szczeliny między kolejnymi komórkami
            if (r1 < r0) r1 = r0;
            if (r0 < maskTop) r0 = maskTop;
            if (r1 > maskBot) r1 = maskBot;
            for (row = r0; row <= r1; row++) {
              if (cover[row] === 1) continue;
              den = row + 0.5 - horizon;
              if (den <= 1e-6) continue;
              dCapM = planeH / den;
              if (dCapM > maxDepthM) dCapM = maxDepthM;
              cover[row] = 1;
              coveredCount++;
              dCapCells = dCapM * invMpc;
              capXm = (cam.x + rdx * dCapCells) * mpc;
              capYm = (cam.y + rdy * dCapCells) * mpc;
              capFog = Math.exp(-dCapM / fogDist);
              lum = lightAt(rig, capXm, capYm, top, surfaceLight, capAccess) * FACE_FLOOR;
              if (capM.emissive > 0) lum += (1 - lum) * capM.emissive;
              packed = fogShade(capM, lum, capFog, skyM, skyLum, capAccess);
              if (packed < 0) continue;
              // czapka jest pozioma, więc w głąb rozciąga się dużo mocniej niż
              // w poprzek: przy horyzoncie jeden wiersz to dziesiątki metrów
              capFoot = dCapM / den;
              if (dCapM / kh > capFoot) capFoot = dCapM / kh;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(capM, lum * capFog, capXm, capYm, top, capFoot),
                packed,
              );
            }
            while (maskTop <= maskBot && cover[maskTop] === 1) maskTop++;
            while (maskBot >= maskTop && cover[maskBot] === 1) maskBot--;
          }
        }

        // --- spód: poziomy dół bryły, widoczny, gdy oko jest niżej ---
        //
        // Lustrzane odbicie czapki i **to jest miejsce, w którym siedział błąd
        // z M2b**: spód korony drzewa nie jest stropem ciągnącym się nad graczem,
        // tylko płaszczyzną tej jednej komórki. Ograniczenie do odcinka promienia
        // wewnątrz komórki jest całą różnicą.
        if (eyeZ < bottom) {
          planeH = (bottom - eyeZ) * kv;
          r0 = Math.ceil(horizon - planeH / dEnterM - 0.5);
          r1 =
            dExitM >= maxDepthM
              ? Math.ceil(horizon - 0.5) - 1
              : Math.ceil(horizon - planeH / dExitM - 0.5) - 1;
          if (r1 < r0) r1 = r0;
          if (r0 < maskTop) r0 = maskTop;
          if (r1 > maskBot) r1 = maskBot;
          for (row = r0; row <= r1; row++) {
            if (cover[row] === 1) continue;
            den = horizon - (row + 0.5);
            if (den <= 1e-6) continue;
            dCapM = planeH / den;
            if (dCapM > maxDepthM) dCapM = maxDepthM;
            cover[row] = 1;
            coveredCount++;
            dCapCells = dCapM * invMpc;
            capXm = (cam.x + rdx * dCapCells) * mpc;
            capYm = (cam.y + rdy * dCapCells) * mpc;
            capFog = Math.exp(-dCapM / fogDist);
            lum = lightAt(rig, capXm, capYm, bottom, surfaceLight, faceAccess) * FACE_CEIL;
            if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
            packed = fogShade(wallM, lum, capFog, skyM, skyLum, faceAccess);
            if (packed < 0) continue;
            capFoot = dCapM / den;
            if (dCapM / kh > capFoot) capFoot = dCapM / kh;
            screen.putUnsafe(
              col,
              row,
              materialGlyph(wallM, lum * capFog, capXm, capYm, bottom, capFoot),
              packed,
            );
          }
          while (maskTop <= maskBot && cover[maskTop] === 1) maskTop++;
          while (maskBot >= maskTop && cover[maskBot] === 1) maskBot--;
        }
      }

      // Komórka, przez którą właśnie przeszliśmy, jest komórką poprzednią dla
      // następnego kroku. Ograniczenie dostępu do nieba działa wyłącznie, gdy oko
      // jest pod stropem tej komórki: bajt światła opisuje całą kolumnę jedną
      // liczbą (§3.1), więc stojąc na łące nad lochem czytalibyśmy zero z korytarza
      // pięć metrów niżej i cały widok gasłby bez powodu.
      carryAccess = 15;
      if (underLight < 15 && eyeZ < target.spanTop(mapX, mapY, n - 1) - 0.5) {
        carryAccess = underLight;
      }
    } else {
      carryAccess = 15; // komórka bez spanów niczego nie ogranicza
    }

    if (coveredCount >= rows) break; // maska pełna — nic już nie dojdzie
    if (dExit > ctx.maxDepth) break;

    if (sdx < sdy) {
      dEnter = sdx;
      sdx += ddx;
      mapX += stepX;
      side = 0;
    } else {
      dEnter = sdy;
      sdy += ddy;
      mapY += stepY;
      side = 1;
    }
    dExit = sdx < sdy ? sdx : sdy;
  }

  // --- niebo: wiersze, w które nie trafiła żadna geometria ---
  //
  // Kryterium jest geometryczne, nie kolorystyczne: maska zaznacza pokrycie także
  // wtedy, gdy powierzchnia była za ciemna, żeby ją namalować. Dzięki temu ściana
  // lochu poniżej progu widoczności zostaje **czarna**, a nie zamieniona w niebo.
  // Dostęp do nieba komórki, w której marsz się skończył, decyduje o tym, czy
  // „nic nie trafiłem" znaczy niebo, czy dziurę w geometrii pod ziemią.
  for (row = 0; row < rows; row++) {
    if (cover[row] === 1) continue;
    if (skyIfOpen(screen, col, row, skyM, skyLum, carryAccess, rdx, rdy, horizon, kv)) {
      if (ctx.skyMask !== null) ctx.skyMask[row * cols + col] = 1;
    }
  }
}
