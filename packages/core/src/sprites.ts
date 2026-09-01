/**
 * Sprite'y jako **billboardy znakowe**: siatka glifów, nie bitmapa.
 *
 * Skalowanie próbkuje najbliższego sąsiada, więc potwór z bliska to te same znaki
 * co z daleka, tylko większe — i to jest cecha, a nie ograniczenie: w buforze
 * znakowym każdy inny filtr daje kaszę.
 *
 * Trzy rzeczy odróżniają to od naklejki:
 *
 * 1. **Cztery kierunki.** Zestaw klatek wybiera kąt między zwrotem bytu a kierunkiem
 *    na kamerę, jak w Doomie. Kosztuje tylko więcej danych w paczce contentu,
 *    a bez tego NPC obraca się razem z graczem i czyta się jak kartka.
 * 2. **Test głębi per komórka znakowa** przeciwko `Screen.depth`. Nie per kolumna:
 *    od M2 kolumna z otworem ma trzy różne głębokości i sprite w drzwiach musi być
 *    widoczny, a ten za ścianą — nie.
 * 3. **Światło z komórki, na której byt stoi.** Potwór w ciemnym lochu jest
 *    niewidoczny i to jest mechanika, nie błąd — ta sama zasada co przy powierzchniach
 *    w M2.
 */

import type { Camera } from './raymarch.js';
import type { Screen } from './screen.js';
import { shade } from './color.js';

/** Ile kierunków ma jeden byt: przód, bok prawy, tył, bok lewy. */
export const SPRITE_DIRS = 4;

/**
 * Klatki jednego bytu. `frames` jest indeksowane `klatka * SPRITE_DIRS + kierunek`,
 * a każdy element to `w * h` kodów znaków, gdzie **zero znaczy przezroczysty**.
 */
export interface SpriteFrames {
  readonly w: number;
  readonly h: number;
  readonly frames: readonly Uint16Array[];
  /** liczba klatek animacji (nie licząc kierunków) */
  readonly count: number;
  /** barwa bazowa, przyciemniana światłem komórki */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** metry: wysokość bytu w świecie, z niej wynika rozmiar na ekranie */
  readonly heightM: number;
  /** metry: szerokość bytu w świecie — osobno, bo komórka znakowa nie jest kwadratem */
  readonly widthM: number;
}

/** Byt do narysowania w tej klatce. Renderer nie wie, skąd się wziął. */
export interface SpriteInstance {
  /** pozycja w komórkach świata (jak kamera) */
  x: number;
  y: number;
  /** metry: wysokość podstawy, czyli gruntu pod bytem */
  baseZ: number;
  /** radiany: w którą stronę byt patrzy */
  yaw: number;
  /** indeks klatki animacji */
  frame: number;
  /** 0..1 — światło komórki, na której byt stoi */
  lum: number;
  /**
   * Barwa na tę jedną klatkę, zamiast barwy z `frames`. Tędy idzie rozbłysk
   * trafienia: **podmiana barwy, a nie podbicie luminancji** — luminancja powyżej
   * jedynki jest przycinana przez `shade` do bieli i byt traci barwę zamiast
   * błysnąć. Renderer nie wie, co ten błysk znaczy; decyzję podejmuje warstwa gry.
   */
  r?: number;
  g?: number;
  b?: number;
  frames: SpriteFrames;
}

/**
 * Rysuje byty do bufora znaków. Kolejność listy nie ma znaczenia: każdy piksel
 * przechodzi test głębi i **zapisuje** swoją głębokość, więc bliższy sprite wygrywa
 * niezależnie od tego, który był rysowany pierwszy. Dzięki temu nie ma sortowania
 * ani jego kosztu.
 */
export function drawSprites(
  screen: Screen,
  cam: Camera,
  ctx: { kv: number; horizon: number; metersPerCell: number; dirX: number; dirY: number; planeX: number; planeY: number },
  list: readonly SpriteInstance[],
  count: number,
): number {
  const cols = screen.cols;
  const rows = screen.rows;
  const kv = ctx.kv;
  const horizon = ctx.horizon;
  const mpc = ctx.metersPerCell;
  const dirX = ctx.dirX;
  const dirY = ctx.dirY;
  const planeX = ctx.planeX;
  const planeY = ctx.planeY;
  // odwrotność macierzy [plane | dir] — ta sama sztuczka co w klasycznym raycasterze
  const planeLen = Math.sqrt(planeX * planeX + planeY * planeY);
  const det = planeX * dirY - dirX * planeY;
  if (det > -1e-9 && det < 1e-9) return 0;
  const invDet = 1 / det;

  let drawn = 0;

  for (let s = 0; s < count; s++) {
    const inst = list[s];
    if (inst === undefined) continue;
    const rx = inst.x - cam.x;
    const ry = inst.y - cam.y;
    // transformY to odległość prostopadła do ekranu, czyli ta sama miara co w DDA
    const tx = invDet * (dirY * rx - dirX * ry);
    const ty = invDet * (-planeY * rx + planeX * ry);
    if (ty <= 0.05) continue; // za kamerą albo w niej

    const distM = ty * mpc;
    const f = inst.frames;
    // wysokość w wierszach wprost z wysokości w metrach — sprite kurczy się
    // dokładnie tak samo jak ściana obok niego
    const hRows = (f.heightM * kv) / distM;
    if (hRows < 1) continue; // mniejszy niż wiersz — nie ma czego rysować
    // Szerokość liczy się z INNEJ skali niż wysokość: pion mierzy `kv` (metry na
    // wiersz), a poziom — długość wektora płaszczyzny (metry na kolumnę). Wyprowadzenie
    // szerokości z wysokości razy proporcje rysunku daje sprite'a rozdętego dokładnie
    // o proporcje komórki znakowej, czyli mniej więcej dwukrotnie.
    const wCols = (cols * 0.5 * (f.widthM / mpc)) / (planeLen * ty);

    const midCol = (cols * 0.5) * (1 + tx / ty);
    const baseRow = horizon - ((inst.baseZ - cam.eyeZ) * kv) / distM;
    const topRow = baseRow - hRows;

    let c0 = Math.floor(midCol - wCols * 0.5);
    let c1 = Math.ceil(midCol + wCols * 0.5);
    let r0 = Math.floor(topRow);
    let r1 = Math.ceil(baseRow);
    if (c1 <= 0 || c0 >= cols || r1 <= 0 || r0 >= rows) continue;
    if (c0 < 0) c0 = 0;
    if (c1 > cols) c1 = cols;
    if (r0 < 0) r0 = 0;
    if (r1 > rows) r1 = rows;

    const grid = f.frames[pickFrame(f, inst, cam)];
    if (grid === undefined) continue;

    // Byt zbyt ciemny, żeby go było widać, nie jest malowany wcale — ta sama
    // zasada co `Material.minLum` dla powierzchni. Potwór w ciemnym lochu jest
    // niewidoczny i to jest mechanika, nie przeoczenie.
    const color = shade(inst.r ?? f.r, inst.g ?? f.g, inst.b ?? f.b, inst.lum);
    if (color === 0) continue;
    let painted = 0;
    for (let row = r0; row < r1; row++) {
      // próbkowanie najbliższego sąsiada: wiersz ekranu → wiersz sprite'a
      const sy = Math.floor(((row + 0.5 - topRow) / hRows) * f.h);
      if (sy < 0 || sy >= f.h) continue;
      for (let col = c0; col < c1; col++) {
        const i = row * cols + col;
        if (distM >= screen.depth[i]!) continue; // za ścianą
        const sx = Math.floor(((col + 0.5 - (midCol - wCols * 0.5)) / wCols) * f.w);
        if (sx < 0 || sx >= f.w) continue;
        const ch = grid[sy * f.w + sx] ?? 0;
        if (ch === 0) continue; // przezroczysty piksel sprite'a
        screen.putDepth(col, row, ch, color, distM);
        painted++;
      }
    }
    if (painted > 0) drawn++;
  }

  return drawn;
}

/**
 * Który zestaw klatek: przód, bok czy tył. Liczy kąt między zwrotem bytu
 * a kierunkiem **od bytu do kamery**, więc obracający się potwór pokazuje kolejno
 * bok i tył, a stojący tyłem zostaje tyłem, gdy gracz go obchodzi.
 */
function pickFrame(f: SpriteFrames, inst: SpriteInstance, cam: Camera): number {
  const toCamX = cam.x - inst.x;
  const toCamY = cam.y - inst.y;
  const rel = Math.atan2(toCamY, toCamX) - inst.yaw;
  // 0 = kamera przed bytem (przód), π = za nim (tył)
  let a = rel;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  const dir = Math.round(a / (Math.PI * 0.5)) % SPRITE_DIRS;
  const frame = inst.frame < 0 ? 0 : inst.frame % f.count;
  return frame * SPRITE_DIRS + dir;
}

/**
 * Kompiluje sprite'a z tekstu. Każdy kierunek to tablica wierszy, spacja znaczy
 * przezroczyste — dzięki temu dane w paczce contentu wyglądają jak rysunek,
 * a nie jak tablica liczb.
 */
export function compileSprite(
  art: readonly (readonly string[])[],
  color: { r: number; g: number; b: number },
  heightM: number,
  widthM: number,
): SpriteFrames {
  if (art.length === 0 || art.length % SPRITE_DIRS !== 0) {
    throw new Error('sprite: liczba zestawów musi być wielokrotnością czterech kierunków');
  }
  let w = 0;
  let h = 0;
  for (const dirArt of art) {
    h = Math.max(h, dirArt.length);
    for (const line of dirArt) w = Math.max(w, line.length);
  }
  const frames: Uint16Array[] = [];
  for (const dirArt of art) {
    const grid = new Uint16Array(w * h);
    for (let y = 0; y < dirArt.length; y++) {
      const line = dirArt[y] ?? '';
      for (let x = 0; x < line.length; x++) {
        const ch = line.charCodeAt(x);
        grid[y * w + x] = ch === 32 ? 0 : ch;
      }
    }
    frames.push(grid);
  }
  return { w, h, frames, count: art.length / SPRITE_DIRS, ...color, heightM, widthM };
}
