import {
  Screen,
  blit,
  computeMetrics,
  createRenderContext,
  renderWorld,
  pack15,
  MATERIALS,
  DEFAULT_TARGET_COLS,
} from '@rpg/core';
import type { Camera } from '@rpg/core';
import { buildTestCity, CELL_METERS } from '@rpg/world';

/**
 * Punkt wejścia: pętla, wejście, sklejenie całości. Cała geometria siedzi
 * w rendererze, cały świat w siatce spanów — tutaj zostaje wyłącznie to, czego
 * żadna z tych warstw nie ma prawa wiedzieć: klawiatura, mysz i zegar.
 */

const FONT_STACK = '"DejaVu Sans Mono","Liberation Mono",Menlo,Consolas,"Courier New",monospace';

/** metry: wysokość oka nad powierzchnią, na którą właśnie weszliśmy */
const PLAYER_EYE = 1.7;
/** metry: pełna wysokość sylwetki — o nią pytamy przy kolizji z nadprożem */
const PLAYER_HEIGHT = 1.85;
/** metry: próg, na który da się wejść bez skakania (krawężnik, stopień) */
const STEP_UP = 0.6;
const WALK_SPEED = 6;
const RUN_SPEED = 13;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = 1.1;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Brak kontekstu 2D');

const screen = new Screen(80, 40);
let metrics = computeMetrics(1, 1, DEFAULT_TARGET_COLS, FONT_STACK, measure);

const world = buildTestCity(1337);
const render = createRenderContext(MATERIALS, {
  cellW: metrics.cellW,
  cellH: metrics.cellH,
  metersPerCell: CELL_METERS,
  maxDepth: 64,
  fogDist: 90,
  ambient: 0.3,
});

const cam: Camera = {
  x: 33.0,
  y: 32.5,
  eyeZ: PLAYER_EYE,
  yaw: Math.PI / 2,
  pitch: 0.06,
  fov: (74 * Math.PI) / 180,
};
cam.eyeZ = groundAt(cam.x, cam.y, cam.eyeZ) + PLAYER_EYE;

function measure(fontPx: number, fontStack: string): number {
  if (!ctx) return fontPx * 0.6;
  ctx.font = `${fontPx}px ${fontStack}`;
  return ctx.measureText('M').width;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  metrics = computeMetrics(w, h, DEFAULT_TARGET_COLS, FONT_STACK, measure);
  screen.resize(metrics.cols, metrics.rows);
  // Kv zależy od proporcji komórki znakowej, więc renderer musi je znać
  render.cellW = metrics.cellW;
  render.cellH = metrics.cellH;
}

/* ---------------- wejście ---------------- */

const keys: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  cam.yaw += e.movementX * MOUSE_SENS;
  cam.pitch -= e.movementY * MOUSE_SENS;
  if (cam.pitch > PITCH_LIMIT) cam.pitch = PITCH_LIMIT;
  if (cam.pitch < -PITCH_LIMIT) cam.pitch = -PITCH_LIMIT;
});
window.addEventListener('resize', resize);

/* ---------------- ruch ---------------- */

/** Wysokość powierzchni pod podanym punktem, licząc od stóp gracza. */
function groundAt(x: number, y: number, eyeZ: number): number {
  const surf = world.surfaceHeight(Math.floor(x), Math.floor(y), eyeZ - PLAYER_EYE + STEP_UP);
  return Number.isFinite(surf) ? surf : 0;
}

/**
 * Próba przesunięcia na nową pozycję. Kolizja jest celowo prymitywna — "nie
 * wchodź w ścianę" i nic więcej; reszta to zakres późniejszych zadań.
 */
function tryMove(nx: number, ny: number): void {
  const cx = Math.floor(nx);
  const cy = Math.floor(ny);
  const feet = cam.eyeZ - PLAYER_EYE;
  const surf = world.surfaceHeight(cx, cy, feet + STEP_UP);
  if (!Number.isFinite(surf)) return;
  if (world.blocks(cx, cy, surf + 0.05, surf + PLAYER_HEIGHT)) return;
  cam.x = nx;
  cam.y = ny;
  cam.eyeZ = surf + PLAYER_EYE;
}

function step(dt: number): void {
  const speed = (keys['ShiftLeft'] || keys['ShiftRight'] ? RUN_SPEED : WALK_SPEED) * dt;
  const turn = 2.4 * dt;
  if (keys['ArrowLeft']) cam.yaw -= turn;
  if (keys['ArrowRight']) cam.yaw += turn;

  let fwd = 0;
  let strafe = 0;
  if (keys['KeyW'] || keys['ArrowUp']) fwd += 1;
  if (keys['KeyS'] || keys['ArrowDown']) fwd -= 1;
  if (keys['KeyD']) strafe += 1;
  if (keys['KeyA']) strafe -= 1;
  if (fwd === 0 && strafe === 0) return;

  const dirX = Math.cos(cam.yaw);
  const dirY = Math.sin(cam.yaw);
  let mx = dirX * fwd - dirY * strafe;
  let my = dirY * fwd + dirX * strafe;
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx = (mx / len) * speed;
    my = (my / len) * speed;
  }
  // osobno w X i Y, żeby dało się ślizgać wzdłuż ściany zamiast się w niej kleić
  tryMove(cam.x + mx, cam.y);
  tryMove(cam.x, cam.y + my);
}

/* ---------------- pętla ---------------- */

const HUD_COLOR = pack15(210, 225, 245);
const HUD_DIM = pack15(90, 140, 160);
let prevT = 0;
let fps = 0;

function frame(t: number): void {
  const dt = prevT === 0 ? 0 : Math.min(0.05, (t - prevT) * 0.001);
  prevT = t;
  if (dt > 0) fps += (1 / dt - fps) * 0.1;

  step(dt);
  renderWorld(world, cam, screen, render);
  drawHud();
  blit(
    screen,
    ctx!,
    metrics.cellW,
    metrics.cellH,
    metrics.fontPx,
    FONT_STACK,
    metrics.widthPx,
    metrics.heightPx,
  );
  requestAnimationFrame(frame);
}

/** HUD idzie do tego samego bufora znaków co świat — zero warstw HTML. */
function drawHud(): void {
  screen.text(1, 0, `${fps.toFixed(0)} fps  ${screen.cols}x${screen.rows}`, HUD_COLOR);
  screen.text(
    1,
    1,
    `x ${cam.x.toFixed(1)}  y ${cam.y.toFixed(1)}  z ${cam.eyeZ.toFixed(1)}m`,
    HUD_DIM,
  );
  screen.text(1, screen.rows - 1, 'WASD + mysz (klik = pointer lock), Shift = bieg', HUD_DIM);
}

resize();
requestAnimationFrame(frame);
