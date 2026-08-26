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
import { shade } from './color.js';

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
  hasOpenings: number;
  /**
   * Ile kolumn tej klatki poszło ścieżką maski pokrycia. Diagnostyka, nie stan:
   * maska kosztuje 1,8× kolumny szybkiej ścieżki, a włącza ją **wpis w paczce
   * contentu** (`MaterialDef.transparent`). Bez tego licznika oznaczenie wody
   * jako przezroczystej wysłałoby każdą scenę z rzeką na wolną ścieżkę i nikt
   * by się nie dowiedział. Testy pilnują, żeby w scenach zewnętrznych było zero.
   */
  maskedColumns: number;
  /** bufor trafień, którego renderWorld używa dla kolejnych kolumn */
  hits: ColumnHits;
  /** zasięg marszu w komórkach */
  maxDepth: number;
  /** twardy limit kroków DDA na kolumnę — kolumna nie ma prawa kosztować w nieskończoność */
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
   * Używana **tylko** w kolumnach z otworem; kolumna bez otworu jej nie dotyka.
   */
  coverage: Uint8Array;
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
  /** powierzchnia pod kamerą — punkt zaczepienia frontu dolnego */
  floorZ0: number;
  floorMat0: number;
  /** sufit nad kamerą — punkt zaczepienia frontu górnego */
  ceilZ0: number;
  ceilMat0: number;
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
    // domyślnie zachowawczo: `renderWorld` przelicza to na każdej klatce, ale
    // `renderColumn` wołane samodzielnie nie ma kiedy
    skyMaterial: opts?.skyMaterial ?? -1,
    hasOpenings: 1,
    maskedColumns: 0,
    hits: createColumnHits(),
    maxDepth: opts?.maxDepth ?? 96,
    maxSteps: opts?.maxSteps ?? 192,
    metersPerCell: opts?.metersPerCell ?? 2,
    fogDist: opts?.fogDist ?? 90,
    ambient: opts?.ambient ?? 0.25,
    light: rig,
    coverage: new Uint8Array(256),
    cellW: opts?.cellW ?? 6,
    cellH: opts?.cellH ?? 10,
    kh: 0,
    kv: 0,
    horizon: 0,
    dirX: 1,
    dirY: 0,
    planeX: 0,
    planeY: 1,
    floorZ0: -NO_SURFACE,
    floorMat0: 0,
    ceilZ0: NO_SURFACE,
    ceilMat0: 0,
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

  let openings = 0;
  for (let i = 0; i < ctx.materials.length; i++) {
    if (ctx.materials[i]?.transparent === true) {
      openings = 1;
      break;
    }
  }
  ctx.hasOpenings = openings;
  ctx.maskedColumns = 0;

  seedFrontiers(target, cam, ctx);
  // maska musi pomiescic caly ekran; realokacja tylko przy zmianie rozmiaru okna
  if (ctx.coverage.length < rows) ctx.coverage = new Uint8Array(rows);

  for (let col = 0; col < cols; col++) {
    renderColumn(target, cam, screen, col, ctx.hits, ctx);
  }
}

/**
 * Ustala, na czym kamera stoi i co ma nad głową. To punkt zaczepienia obu frontów:
 * bez niego pierwszy widoczny span nie wie, gdzie kończy się jego ściana, a gdzie
 * zaczyna powierzchnia, po której idziemy.
 */
function seedFrontiers(target: RenderTarget, cam: Camera, ctx: RenderContext): void {
  const cx = Math.floor(cam.x);
  const cy = Math.floor(cam.y);
  const n = target.spanCount(cx, cy);
  let fz = -NO_SURFACE;
  let fm = 0;
  let cz = NO_SURFACE;
  let cm = 0;
  for (let i = 0; i < n; i++) {
    const top = target.spanTop(cx, cy, i);
    const bottom = target.spanBottom(cx, cy, i);
    if (top <= cam.eyeZ && top > fz) {
      fz = top;
      fm = target.spanCapMaterial(cx, cy, i);
    }
    if (bottom >= cam.eyeZ && bottom < cz) {
      cz = bottom;
      cm = target.spanMaterial(cx, cy, i);
    }
  }
  ctx.floorZ0 = fz;
  ctx.floorMat0 = fm;
  ctx.ceilZ0 = cz;
  ctx.ceilMat0 = cm;
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

  let loRow = rows;
  let hiRow = -1;
  let floorZ = ctx.floorZ0;
  let floorMat = ctx.floorMat0;
  let ceilZ = ctx.ceilZ0;
  let ceilMat = ctx.ceilMat0;
  let blocked = 0;
  /**
   * Tryb maski. Kolumna wchodzi w niego dopiero, gdy trafi na span z materialem
   * przezroczystym — czyli na otwor drzwiowy albo okno. Dopoki tego nie ma,
   * dziala szybka sciezka dwoch frontow i nie placi ani jednego odczytu maski.
   */
  let masked = 0;
  let coveredCount = 0;

  let side = 0;
  let dist = 0;
  let distM = 0;
  let invDistM = 0;
  let fog = 0;
  let face = 1;
  let rawLight = 0;
  let surfaceLight = 0;
  let underLight = 0;
  let faceAccess = 0;
  let capAccess = 0;
  /** dostęp do nieba komórki z poprzedniego kroku DDA — patrz pętla niżej */
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
  let rowSurf = 0;
  let rowOther = 0;
  let rowCap = 0;
  let rFirst = 0;
  let rLast = 0;
  let r0 = 0;
  let r1 = 0;
  let wallEnd = 0;
  let wallStart = 0;
  let row = 0;
  let capZ = 0;
  let wallLimitZ = 0;
  let capMat = 0;
  let capLight = 0;
  let matId = 0;
  let k = 0;
  let den = 0;
  let dCapM = 0;
  let dCapCells = 0;
  let zRow = 0;
  let lum = 0;
  let capXm = 0;
  let capYm = 0;
  let skyM: Material | undefined;
  let skyLum = 0;
  let covered = 0;
  let wallM: Material | undefined;
  let capM: Material | undefined;
  let probe: Material | undefined;

  hits.count = 0;

  // Niebo jest w nieskonczonosci: bez mgly, bez tlumienia odlegloscia, z pelnym
  // dostepem do nieba. Pora doby wchodzi ta sama funkcja co dla powierzchni.
  skyM = ctx.skyMaterial >= 0 ? materials[ctx.skyMaterial] : undefined;
  skyLum = staticLum(rig, 15, 15);
  if (skyM !== undefined && skyM.emissive > 0) skyLum += (1 - skyLum) * skyM.emissive;

  // Pierwszy krok nie ma poprzedniej iteracji, więc jedyny lookup „wstecz"
  // w całym marszu dotyczy komórki kamery.
  carryAccess = 15;
  pn = target.spanCount(mapX, mapY);
  if (pn > 0) {
    prevUnder = target.light(mapX, mapY);
    prevUnder = prevUnder >> 4 === 0 ? 15 : prevUnder & 15;
    if (prevUnder < 15 && eyeZ < target.spanTop(mapX, mapY, pn - 1) - 0.5) {
      carryAccess = prevUnder;
    }
  }

  for (let step = 0; step < ctx.maxSteps; step++) {
    if (sdx < sdy) {
      dist = sdx;
      sdx += ddx;
      mapX += stepX;
      side = 0;
    } else {
      dist = sdy;
      sdy += ddy;
      mapY += stepY;
      side = 1;
    }
    if (dist > ctx.maxDepth) break;
    if (dist < 1e-4) continue;

    n = target.spanCount(mapX, mapY);
    if (n > 0) {
      distM = dist * mpc;
      invDistM = 1 / distM;
      fog = Math.exp(-distM / fogDist);
      face = side === 1 ? 0.7 : 1;
      rawLight = target.light(mapX, mapY);
      // starsza połówka bajtu to światło powierzchni, młodsza — podziemne.
      // Zwykła wartość 0..15 ma starszą połówkę zerową, więc `|| ` sprowadza
      // ją z powrotem do tej samej liczby i stare siatki działają bez zmian.
      // Bajt światła ma dwie połówki: starsza to jasność powierzchni, młodsza —
      // dostęp do nieba. Siatka sprzed M2 (`SpanGrid` paczki neon) trzyma czystą
      // wartość 0..15, więc starsza połówka wychodzi zerem: czytamy ją wtedy jako
      // jasność, a dostęp do nieba jako pełny. Dzięki temu M0 renderuje się bajt
      // w bajt tak samo.
      surfaceLight = rawLight >> 4;
      if (surfaceLight === 0) {
        surfaceLight = rawLight & 15;
        underLight = 15;
      } else {
        underLight = rawLight & 15;
      }
      // Lico ściany oświetla **pustka, która na nie patrzy**, a nie bryła, do której
      // należy. Ściana korytarza to bok litej skały sięgającej nieba: gdyby liczyło
      // się jej własne światło, korytarz szesnaście metrów pod ziemią byłby jasny
      // jak łąka. Promień przyszedł z pustki korytarza i to jej przepustowość
      // ogranicza światło lica.
      //
      // Wartość jest **niesiona z poprzedniego kroku**, a nie czytana ponownie:
      // DDA odwiedza komórki po kolei, więc „komórka poprzednia" to ta z poprzedniej
      // iteracji i jej bajt światła był już pobrany. Wersja czytająca ją drugi raz
      // kosztowała trzy zapytania do świata na komórkę i 13–28% czasu klatki
      // w scenach, w których żadnej pustki nie ma.
      faceAccess = carryAccess;
      // wallU z dokladnej pozycji trafienia, nigdy z zaokraglonej odleglosci —
      // inaczej tekstura fasady skacze o komorke przy kazdym kroku gracza
      uWorld = side === 0 ? cam.y + dist * rdy : cam.x + dist * rdx;
      uFrac = uWorld - Math.floor(uWorld);
      uMetres = uWorld * mpc;
      wallAxisM = (side === 0 ? mapX : mapY) * mpc;
      // rzutowany rozmiar komorki na scianie: pion rozciaga sie mocniej niz poziom,
      // bo kv < kh, wiec to on decyduje o aliasingu
      wallFoot = distM / kv;
      hitXm = (cam.x + dist * rdx) * mpc;
      hitYm = (cam.y + dist * rdy) * mpc;

      // Otwor w kolumnie: gdy w komorce jest span przezroczysty, dwa fronty
      // przestaja wystarczac, bo geometria za otworem trafia w SRODEK obrazu.
      // Przechodzimy na maske i zasiewamy ja tym, co fronty juz zamalowaly.
      if (masked === 0 && ctx.hasOpenings === 1) {
        for (i = 0; i < n; i++) {
          probe = materials[target.spanMaterial(mapX, mapY, i)];
          if (probe !== undefined && probe.transparent) {
            for (row = 0; row < rows; row++) {
              if (row <= hiRow || row >= loRow) {
                cover[row] = 1;
                coveredCount++;
              } else {
                cover[row] = 0;
              }
            }
            masked = 1;
            ctx.maskedColumns++;
            break;
          }
        }
      }

      // --- front dolny: wszystko, na co patrzymy z gory (teren, bruk, fasady) ---
      for (i = n - 1; i >= 0; i--) {
        bottom = target.spanBottom(mapX, mapY, i);
        if (bottom >= eyeZ) continue; // sufit — druga petla
        matId = target.spanMaterial(mapX, mapY, i);
        wallM = materials[matId];
        // span przezroczysty nie maluje sie i nie przesuwa frontu — jest dziura
        if (wallM !== undefined && wallM.transparent) continue;
        top = target.spanTop(mapX, mapY, i);
        // Powierzchnia jest zadaszona, gdy nad nia jest span oddzielony pustka.
        // Pien drzewa stoi na gruncie bez przerwy, wiec lasu to nie dotyczy;
        // strop komory i dach chaty odstaja od podlogi o wysokosc wnetrza.
        roofed = i + 1 < n && target.spanBottom(mapX, mapY, i + 1) - top > 0.5 ? 1 : 0;
        // czapka pod stropem widzi niebo tylko tyle, ile przepuszcza pustka
        // nad nią; poza stropem — całe
        capAccess = roofed === 1 ? underLight : 15;
        rowSurf = horizon - (top - eyeZ) * kv * invDistM;
        rFirst = Math.ceil(rowSurf - 0.5);
        if (masked === 0 && rFirst >= loRow) continue; // zasloniety w calosci

        if (masked === 1) {
          r0 = rFirst < 0 ? 0 : rFirst;
          r1 = rows - 1;
        } else {
          r0 = rFirst > hiRow + 1 ? rFirst : hiRow + 1;
          if (r0 < 0) r0 = 0;
          r1 = loRow - 1;
          if (r1 > rows - 1) r1 = rows - 1;
        }

        if (r0 <= r1) {
          // nizsza z dwoch powierzchni wyznacza czapke, roznica miedzy nimi — sciane
          if (floorZ < top) {
            // czapka jest przedluzeniem POPRZEDNIEJ powierzchni, wiec nalezy do
            // pustki, przez ktora idzie promien — swiatlo bierzemy stamtad, tak
            // samo jak dla lica sciany. Inaczej podloga korytarza tuz przed lita
            // skala rozjasnia sie do wartosci powierzchni.
            capZ = floorZ;
            capMat = floorMat;
            capLight = faceAccess;
          } else {
            capZ = top;
            capMat = target.spanCapMaterial(mapX, mapY, i);
            capLight = capAccess;
          }
          // sciana konczy sie na wyzszej z dwoch krawedzi: wlasnym spodzie spanu
          // albo poprzedniej powierzchni. Dzieki temu przeslo ogladane z gory ma
          // lico grubosci przesla, a nie sciane ciagnaca sie do ziemi
          wallLimitZ = capZ > bottom ? capZ : bottom;
          rowCap = horizon - (wallLimitZ - eyeZ) * kv * invDistM;
          wallEnd = Math.ceil(rowCap - 0.5) - 1;
          if (wallEnd > r1) wallEnd = r1;

          if (wallM !== undefined) {
            for (row = r0; row <= wallEnd; row++) {
              if (masked === 1) {
                if (cover[row] === 1) continue;
                cover[row] = 1;
                coveredCount++;
              }
              zRow = eyeZ + (horizon - (row + 0.5)) * distM / kv;
              lum = lightAt(rig, hitXm, hitYm, zRow, surfaceLight, faceAccess) * fog * face;
              if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
              if (lum < wallM.minLum) {
                // Powierzchnia zgaszona przez mgłę nie jest czarna, tylko zlewa się
                // z niebem — bez tego odległy grzbiet wycina w niebie czarną dziurę.
                // Pod ziemią `faceAccess` jest zerem i zostaje czerń, więc test
                // ciemności trzyma się bez zmian.
                if (skyM !== undefined && faceAccess > 0 && skyLum >= skyM.minLum) {
                  skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
                }
                continue;
              }
              screen.putUnsafe(
                col,
                row,
                materialGlyph(wallM, lum, uMetres, zRow, wallAxisM, wallFoot),
                shade(wallM.r, wallM.g, wallM.b, lum),
              );
            }
          }

          capM = materials[capMat];
          if (capM !== undefined && capZ > -NO_SURFACE) {
            wallStart = wallEnd + 1 > r0 ? wallEnd + 1 : r0;
            for (row = wallStart; row <= r1; row++) {
              if (masked === 1 && cover[row] === 1) continue;
              den = row + 0.5 - horizon;
              if (den <= 1e-6) continue; // ponad horyzontem czapki nie widac
              // czapka jest plaszczyzna pozioma: jej wiersz wynika z wysokosci
              // i odleglosci, a nie z interpolacji miedzy spanami
              dCapM = (eyeZ - capZ) * kv / den;
              if (dCapM <= 0) continue;
              // wiersze tuz przy horyzoncie maja odleglosc dazaca do nieskonczonosci;
              // przycinamy ja do zasiegu zamiast pomijac wiersz, bo pominiety wiersz
              // to dziura w obrazie, a przyciety to po prostu maksymalna mgla
              if (dCapM > maxDepthM) dCapM = maxDepthM;
              if (masked === 1) {
                cover[row] = 1;
                coveredCount++;
              }
              dCapCells = dCapM * invMpc;
              capXm = (cam.x + rdx * dCapCells) * mpc;
              capYm = (cam.y + rdy * dCapCells) * mpc;
              lum = lightAt(rig, capXm, capYm, capZ, surfaceLight, capLight) * Math.exp(-dCapM / fogDist);
              if (capM.emissive > 0) lum += (1 - lum) * capM.emissive;
              if (lum < capM.minLum) {
                if (skyM !== undefined && capLight > 0 && skyLum >= skyM.minLum) {
                  skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
                }
                continue;
              }
              // czapka jest pozioma, wiec w glab rozciaga sie duzo mocniej niz
              // w poprzek: przy horyzoncie jeden wiersz to dziesiatki metrow
              capFoot = dCapM / den;
              if (dCapM / kh > capFoot) capFoot = dCapM / kh;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(capM, lum, capXm, capYm, capZ, capFoot),
                shade(capM.r, capM.g, capM.b, lum),
              );
            }
          }
        }

        // front i stan powierzchni aktualizujemy PO malowaniu — odwrotna kolejnosc
        // zjada wiersz na styku bryl i widac to jako szczeline
        if (rFirst < loRow) loRow = rFirst;
        rowOther = horizon - (bottom - eyeZ) * kv * invDistM;
        k = hits.count;
        if (k < MAX_HITS) {
          hits.dist[k] = distM;
          hits.topZ[k] = top;
          hits.bottomZ[k] = bottom;
          hits.rowTop[k] = rowSurf;
          hits.rowBot[k] = rowOther;
          hits.wallU[k] = uFrac;
          hits.side[k] = side;
          hits.cellIndex[k] = ((mapY & 0xffff) << 16) | (mapX & 0xffff);
          hits.spanIndex[k] = i;
          hits.count = k + 1;
        }
        floorZ = top;
        floorMat = target.spanCapMaterial(mapX, mapY, i);
        if (top > eyeZ) {
          // bryla przecina poziom oka — w szybkiej sciezce za nia nie widac nic.
          // W trybie maski to nieprawda: obok bryly moze byc otwarte przejscie,
          // wiec o koncu kolumny decyduje wylacznie zapelnienie maski.
          blocked = 1;
          break;
        }
      }

      // --- front gorny: sufity i spody mostow, lustrzane odbicie petli wyzej ---
      for (i = 0; i < n; i++) {
        bottom = target.spanBottom(mapX, mapY, i);
        if (bottom < eyeZ) continue;
        matId = target.spanMaterial(mapX, mapY, i);
        wallM = materials[matId];
        if (wallM !== undefined && wallM.transparent) continue;
        top = target.spanTop(mapX, mapY, i);
        // spod stropu widzi sie wylacznie od srodka, wiec liczy sie dostep do nieba
        // pustki, z ktorej promien przyszedl — dokladnie jak przy licach scian
        capAccess = faceAccess;
        rowSurf = horizon - (bottom - eyeZ) * kv * invDistM;
        rLast = Math.ceil(rowSurf - 0.5) - 1;
        if (masked === 0 && rLast <= hiRow) continue; // zasloniety nad okiem

        if (masked === 1) {
          r0 = 0;
          r1 = rLast > rows - 1 ? rows - 1 : rLast;
        } else {
          r0 = hiRow + 1;
          if (r0 < 0) r0 = 0;
          r1 = rLast > rows - 1 ? rows - 1 : rLast;
          if (r1 > loRow - 1) r1 = loRow - 1;
        }

        if (r0 <= r1) {
          // lustro reguly z dolu: widoczna jest *wyzsza* z dwoch powierzchni
          if (ceilZ > bottom) {
            capZ = ceilZ;
            capMat = ceilMat;
          } else {
            capZ = bottom;
            capMat = matId;
          }
          capLight = capAccess;
          // lustro reguly z dolu: sciana zaczyna sie na nizszej z dwoch krawedzi —
          // wlasnym szczycie spanu albo poprzednim suficie. Bez ograniczenia
          // wlasnym szczytem pierwszy span nad okiem zamalowuje cale niebo
          wallLimitZ = capZ < top ? capZ : top;
          rowCap = horizon - (wallLimitZ - eyeZ) * kv * invDistM;
          wallStart = Math.ceil(rowCap - 0.5);
          if (wallStart < r0) wallStart = r0;

          capM = materials[capMat];
          if (capM === undefined || capZ >= NO_SURFACE) {
            // Nad glowa nie ma sufitu, wiec „czapka" gornego frontu nie istnieje —
            // nad krawedzia bryly jest po prostu niebo. Front i tak zamknie te
            // wiersze za chwile, wiec malujemy je tutaj; inaczej zostana czarne
            // i w kadrze robi sie dziura w niebie w ksztalcie dalekiej korony.
            if (skyM !== undefined && skyLum >= skyM.minLum && faceAccess > 0) {
              wallEnd = wallStart - 1 < r1 ? wallStart - 1 : r1;
              for (row = r0; row <= wallEnd; row++) {
                if (masked === 1) {
                  if (cover[row] === 1) continue;
                  cover[row] = 1;
                  coveredCount++;
                }
                skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
              }
            }
          }
          if (capM !== undefined && capZ < NO_SURFACE) {
            wallEnd = wallStart - 1 < r1 ? wallStart - 1 : r1;
            for (row = r0; row <= wallEnd; row++) {
              if (masked === 1 && cover[row] === 1) continue;
              den = horizon - (row + 0.5);
              if (den <= 1e-6) continue;
              dCapM = (capZ - eyeZ) * kv / den;
              if (dCapM <= 0) continue;
              if (dCapM > maxDepthM) dCapM = maxDepthM;
              if (masked === 1) {
                cover[row] = 1;
                coveredCount++;
              }
              dCapCells = dCapM * invMpc;
              capXm = (cam.x + rdx * dCapCells) * mpc;
              capYm = (cam.y + rdy * dCapCells) * mpc;
              lum = lightAt(rig, capXm, capYm, capZ, surfaceLight, capLight) * Math.exp(-dCapM / fogDist);
              if (capM.emissive > 0) lum += (1 - lum) * capM.emissive;
              if (lum < capM.minLum) {
                if (skyM !== undefined && capLight > 0 && skyLum >= skyM.minLum) {
                  skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
                }
                continue;
              }
              capFoot = dCapM / den;
              if (dCapM / kh > capFoot) capFoot = dCapM / kh;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(capM, lum, capXm, capYm, capZ, capFoot),
                shade(capM.r, capM.g, capM.b, lum),
              );
            }
          }

          if (wallM !== undefined) {
            for (row = wallStart; row <= r1; row++) {
              if (masked === 1) {
                if (cover[row] === 1) continue;
                cover[row] = 1;
                coveredCount++;
              }
              zRow = eyeZ + (horizon - (row + 0.5)) * distM / kv;
              lum = lightAt(rig, hitXm, hitYm, zRow, surfaceLight, faceAccess) * fog * face;
              if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
              if (lum < wallM.minLum) {
                // Powierzchnia zgaszona przez mgłę nie jest czarna, tylko zlewa się
                // z niebem — bez tego odległy grzbiet wycina w niebie czarną dziurę.
                // Pod ziemią `faceAccess` jest zerem i zostaje czerń, więc test
                // ciemności trzyma się bez zmian.
                if (skyM !== undefined && faceAccess > 0 && skyLum >= skyM.minLum) {
                  skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
                }
                continue;
              }
              screen.putUnsafe(
                col,
                row,
                materialGlyph(wallM, lum, uMetres, zRow, wallAxisM, wallFoot),
                shade(wallM.r, wallM.g, wallM.b, lum),
              );
            }
          }
        }

        if (rLast > hiRow) hiRow = rLast;
        rowOther = horizon - (top - eyeZ) * kv * invDistM;
        k = hits.count;
        if (k < MAX_HITS) {
          hits.dist[k] = distM;
          hits.topZ[k] = top;
          hits.bottomZ[k] = bottom;
          hits.rowTop[k] = rowOther;
          hits.rowBot[k] = rowSurf;
          hits.wallU[k] = uFrac;
          hits.side[k] = side;
          hits.cellIndex[k] = ((mapY & 0xffff) << 16) | (mapX & 0xffff);
          hits.spanIndex[k] = i;
          hits.count = k + 1;
        }
        ceilZ = bottom;
        ceilMat = matId;
      }

      // Komórka, przez którą właśnie przeszliśmy, jest komórką poprzednią dla
      // następnego kroku.
      //
      // Ograniczenie dostępu do nieba działa wyłącznie, gdy oko jest **pod stropem**
      // tej komórki. Bajt światła opisuje całą kolumnę jedną liczbą (§3.1), więc
      // stojąc na łące nad lochem czytalibyśmy zero z korytarza pięć metrów niżej
      // i cały widok gasłby bez powodu. Próg 0,5 m odsiewa własną powierzchnię.
      //
      // Sprawdzenie stropu robimy dopiero, gdy komórka w ogóle ma pustkę
      // (`underLight < 15`). Na otwartym terenie ta gałąź nie wchodzi ani razu
      // i przeniesienie światła nie kosztuje żadnego dodatkowego zapytania.
      carryAccess = 15;
      if (underLight < 15 && eyeZ < target.spanTop(mapX, mapY, n - 1) - 0.5) {
        carryAccess = underLight;
      }
    } else {
      carryAccess = 15; // komórka bez spanów niczego nie ogranicza
    }

    if (masked === 1) {
      if (coveredCount >= rows) break; // maska pelna — nic juz nie dojdzie
    } else {
      if (blocked === 1) break;
      if (hiRow + 1 >= loRow) break; // ekran w tej kolumnie zapelniony
    }
  }

  // --- niebo: wiersze, w ktore nie trafila zadna geometria ---
  //
  // Kryterium jest geometryczne, nie kolorystyczne: fronty i maska zaznaczaja
  // pokrycie takze wtedy, gdy powierzchnia byla za ciemna, zeby ja namalowac.
  // Dzieki temu sciana lochu ponizej progu widocznosci zostaje **czarna**,
  // a nie zamieniona w niebo — test ciemnosci z M2 nadal ma sens.
  // `carryAccess` to dostęp do nieba komórki, w której marsz się skończył. Zero
  // znaczy, że promień całą drogę szedł pod stropem — wtedy „nic nie trafiłem" jest
  // dziurą w geometrii albo krawędzią wczytanego świata, a nie widokiem na niebo.
  // Bez tego warunku w komorze lochu pojawiało się szesnaście gwiazd.
  if (skyM !== undefined && skyLum >= skyM.minLum && carryAccess > 0) {
    for (row = 0; row < rows; row++) {
      covered = masked === 1 ? cover[row] ?? 0 : row <= hiRow || row >= loRow ? 1 : 0;
      if (covered === 1) continue;
      skyCell(screen, col, row, skyM, skyLum, rdx, rdy, horizon, kv);
    }
  }
}
