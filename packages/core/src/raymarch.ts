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

export function createRenderContext(
  materials: readonly Material[],
  opts?: RenderOptions,
): RenderContext {
  return {
    materials,
    hits: createColumnHits(),
    maxDepth: opts?.maxDepth ?? 96,
    maxSteps: opts?.maxSteps ?? 192,
    metersPerCell: opts?.metersPerCell ?? 2,
    fogDist: opts?.fogDist ?? 90,
    ambient: opts?.ambient ?? 0.25,
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

  seedFrontiers(target, cam, ctx);

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
  const eyeZ = cam.eyeZ;
  const mpc = ctx.metersPerCell;
  const invMpc = 1 / mpc;
  const fogDist = ctx.fogDist;
  const ambient = ctx.ambient;
  const materials = ctx.materials;
  const maxDepthM = ctx.maxDepth * mpc;

  // kierunek promienia: dir + plane * x, celowo nieznormalizowany — dzięki temu
  // odległość z DDA jest od razu prostopadła i nie ma rybiego oka
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

  let side = 0;
  let dist = 0;
  let distM = 0;
  let invDistM = 0;
  let fog = 0;
  let face = 1;
  let lightF = 1;
  let uWorld = 0;
  let uFrac = 0;
  let hu = 0;
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
  let matId = 0;
  let k = 0;
  let den = 0;
  let dCapM = 0;
  let dCapCells = 0;
  let zRow = 0;
  let lum = 0;
  let wallM: Material | undefined;
  let capM: Material | undefined;

  hits.count = 0;

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
      lightF = ambient + (1 - ambient) * (target.light(mapX, mapY) * 0.0666666666666667);
      // wallU z dokładnej pozycji trafienia, nigdy z zaokrąglonej odległości —
      // inaczej tekstura fasady skacze o komórkę przy każdym kroku gracza
      uWorld = side === 0 ? cam.y + dist * rdy : cam.x + dist * rdx;
      uFrac = uWorld - Math.floor(uWorld);
      hu = Math.floor(uWorld * 4);

      // --- front dolny: wszystko, na co patrzymy z góry (teren, bruk, fasady) ---
      for (i = n - 1; i >= 0; i--) {
        bottom = target.spanBottom(mapX, mapY, i);
        if (bottom >= eyeZ) continue; // sufit — druga pętla
        top = target.spanTop(mapX, mapY, i);
        rowSurf = horizon - (top - eyeZ) * kv * invDistM;
        rFirst = Math.ceil(rowSurf - 0.5);
        if (rFirst >= loRow) continue; // zasłonięty w całości

        r0 = rFirst > hiRow + 1 ? rFirst : hiRow + 1;
        if (r0 < 0) r0 = 0;
        r1 = loRow - 1;
        if (r1 > rows - 1) r1 = rows - 1;

        if (r0 <= r1) {
          // niższa z dwóch powierzchni wyznacza czapkę, różnica między nimi — ścianę
          if (floorZ < top) {
            capZ = floorZ;
            capMat = floorMat;
          } else {
            capZ = top;
            capMat = target.spanCapMaterial(mapX, mapY, i);
          }
          // ściana kończy się na wyższej z dwóch krawędzi: własnym spodzie spanu
          // albo poprzedniej powierzchni. Dzięki temu przęsło oglądane z góry ma
          // lico grubości przęsła, a nie ścianę ciągnącą się do ziemi
          wallLimitZ = capZ > bottom ? capZ : bottom;
          rowCap = horizon - (wallLimitZ - eyeZ) * kv * invDistM;
          wallEnd = Math.ceil(rowCap - 0.5) - 1;
          if (wallEnd > r1) wallEnd = r1;

          matId = target.spanMaterial(mapX, mapY, i);
          wallM = materials[matId];
          if (wallM !== undefined) {
            for (row = r0; row <= wallEnd; row++) {
              zRow = eyeZ + (horizon - (row + 0.5)) * distM / kv;
              lum = lightF * fog * face;
              if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(wallM, lum, hu, Math.floor(zRow * 4), side === 0 ? mapX : mapY),
                shade(wallM.r, wallM.g, wallM.b, lum),
              );
            }
          }

          capM = materials[capMat];
          if (capM !== undefined && capZ > -NO_SURFACE) {
            wallStart = wallEnd + 1 > r0 ? wallEnd + 1 : r0;
            for (row = wallStart; row <= r1; row++) {
              den = row + 0.5 - horizon;
              if (den <= 1e-6) continue; // ponad horyzontem czapki nie widać
              // czapka jest płaszczyzną poziomą: jej wiersz wynika z wysokości
              // i odległości, a nie z interpolacji między spanami
              dCapM = (eyeZ - capZ) * kv / den;
              if (dCapM <= 0) continue;
              // wiersze tuż przy horyzoncie mają odległość dążącą do nieskończoności;
              // przycinamy ją do zasięgu zamiast pomijać wiersz, bo pominięty wiersz
              // to dziura w obrazie, a przycięty to po prostu maksymalna mgła
              if (dCapM > maxDepthM) dCapM = maxDepthM;
              dCapCells = dCapM * invMpc;
              lum = lightF * Math.exp(-dCapM / fogDist);
              if (capM.emissive > 0) lum += (1 - lum) * capM.emissive;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(
                  capM,
                  lum,
                  Math.floor((cam.x + rdx * dCapCells) * 4),
                  Math.floor((cam.y + rdy * dCapCells) * 4),
                  Math.floor(capZ * 2),
                ),
                shade(capM.r, capM.g, capM.b, lum),
              );
            }
          }
        }

        // front i stan powierzchni aktualizujemy PO malowaniu — odwrotna kolejność
        // zjada wiersz na styku brył i widać to jako szczelinę
        loRow = rFirst;
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
          // bryła przecina poziom oka — za nią nie widać już nic
          blocked = 1;
          break;
        }
      }

      // --- front górny: sufity i spody mostów, lustrzane odbicie pętli wyżej ---
      for (i = 0; i < n; i++) {
        bottom = target.spanBottom(mapX, mapY, i);
        if (bottom < eyeZ) continue;
        top = target.spanTop(mapX, mapY, i);
        rowSurf = horizon - (bottom - eyeZ) * kv * invDistM;
        rLast = Math.ceil(rowSurf - 0.5) - 1;
        if (rLast <= hiRow) continue; // zasłonięty przez bliższą geometrię nad okiem

        r0 = hiRow + 1;
        if (r0 < 0) r0 = 0;
        r1 = rLast > rows - 1 ? rows - 1 : rLast;
        if (r1 > loRow - 1) r1 = loRow - 1;

        if (r0 <= r1) {
          // lustro reguły z dołu: widoczna jest *wyższa* z dwóch powierzchni
          if (ceilZ > bottom) {
            capZ = ceilZ;
            capMat = ceilMat;
          } else {
            capZ = bottom;
            capMat = target.spanMaterial(mapX, mapY, i);
          }
          // lustro reguły z dołu: ściana zaczyna się na niższej z dwóch krawędzi —
          // własnym szczycie spanu albo poprzednim suficie. Bez ograniczenia
          // własnym szczytem pierwszy span nad okiem zamalowuje całe niebo
          wallLimitZ = capZ < top ? capZ : top;
          rowCap = horizon - (wallLimitZ - eyeZ) * kv * invDistM;
          wallStart = Math.ceil(rowCap - 0.5);
          if (wallStart < r0) wallStart = r0;

          capM = materials[capMat];
          if (capM !== undefined && capZ < NO_SURFACE) {
            wallEnd = wallStart - 1 < r1 ? wallStart - 1 : r1;
            for (row = r0; row <= wallEnd; row++) {
              den = horizon - (row + 0.5);
              if (den <= 1e-6) continue;
              dCapM = (capZ - eyeZ) * kv / den;
              if (dCapM <= 0) continue;
              if (dCapM > maxDepthM) dCapM = maxDepthM;
              dCapCells = dCapM * invMpc;
              lum = lightF * Math.exp(-dCapM / fogDist);
              if (capM.emissive > 0) lum += (1 - lum) * capM.emissive;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(
                  capM,
                  lum,
                  Math.floor((cam.x + rdx * dCapCells) * 4),
                  Math.floor((cam.y + rdy * dCapCells) * 4),
                  Math.floor(capZ * 2),
                ),
                shade(capM.r, capM.g, capM.b, lum),
              );
            }
          }

          matId = target.spanMaterial(mapX, mapY, i);
          wallM = materials[matId];
          if (wallM !== undefined) {
            for (row = wallStart; row <= r1; row++) {
              zRow = eyeZ + (horizon - (row + 0.5)) * distM / kv;
              lum = lightF * fog * face;
              if (wallM.emissive > 0) lum += (1 - lum) * wallM.emissive;
              screen.putUnsafe(
                col,
                row,
                materialGlyph(wallM, lum, hu, Math.floor(zRow * 4), side === 0 ? mapX : mapY),
                shade(wallM.r, wallM.g, wallM.b, lum),
              );
            }
          }
        }

        hiRow = rLast;
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
        ceilMat = target.spanMaterial(mapX, mapY, i);
      }
    }

    if (blocked === 1) break;
    if (hiRow + 1 >= loRow) break; // ekran w tej kolumnie zapełniony
  }
}
