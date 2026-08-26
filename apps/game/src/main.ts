import {
  Screen,
  blit,
  compileMaterials,
  computeMetrics,
  createRenderContext,
  renderWorld,
  torchFlicker,
  pack15,
  DEFAULT_TARGET_COLS,
} from '@rpg/core';
import type { Camera } from '@rpg/core';
import { wildPack } from '@rpg/content';
import { CELL_METERS, ChunkStore, dungeonsNear } from '@rpg/world';

/**
 * Punkt wejścia: pętla, wejście, sklejenie całości. Cała geometria siedzi
 * w rendererze, cały świat w streamowanych chunkach — tutaj zostaje wyłącznie
 * to, czego żadna z tych warstw nie ma prawa wiedzieć: klawiatura, mysz i zegar.
 */

const FONT_STACK = '"DejaVu Sans Mono","Liberation Mono",Menlo,Consolas,"Courier New",monospace';

/** Ten sam seed co w snapshotach — świat w grze jest tym, który testujemy. */
const SEED = 4242;

/**
 * Start nie jest przypadkowy i nie jest wybrany na oko: wyszukiwarka przeszła
 * teren tego seeda, odsiała łąki z rzeką w zasięgu wzroku i **oceniła je
 * renderem** — liczbą znaków wody, kory i pustego nieba w gotowym kadrze.
 * Pierwszy widok pokazuje więc naraz wysokość, wodę i las, czego wymagał M1 §8.
 *
 * Poprzedni start wybierałem po samych własnościach terenu i wylądował w środku
 * lasu liściastego: korony zasłaniały cały ekran i świat sprawiał wrażenie
 * przyklejonego do twarzy. Kryterium „co widać" jest odporne na taki błąd.
 */
const START_X = 128.5;
const START_Y = -467.5;
const START_YAW = Math.PI;

/** metry: wysokość oka nad powierzchnią, na którą właśnie weszliśmy */
const PLAYER_EYE = 1.7;
/** metry: pełna wysokość sylwetki — o nią pytamy przy kolizji z nadprożem */
const PLAYER_HEIGHT = 1.85;
/** metry: próg, na który da się wejść bez skakania (głaz, korzeń, próg brodu) */
const STEP_UP = 0.6;
/** metry: głębsza woda jest nie do przejścia — pływanie to nie ten milestone */
const WADE_DEPTH = 1;
/**
 * Jak szybko oko dochodzi do wysokości gruntu, w jednostkach na sekundę.
 * Bez tego kamera skacze o próg przy każdym przejściu komórki, a że wiersz
 * ekranu mapuje się na odległość przez `(eyeZ - z)`, jeden taki skok
 * przepróbkowuje **cały** grunt naraz: pomiar pokazał 57,8% komórek zmieniających
 * znak po skoku o 0,2 m, przy 22% dla zwykłego kroku w bok. To była główna
 * przyczyna migotania trawy podczas marszu.
 */
const EYE_SMOOTH = 9;
const WALK_SPEED = 6;
const RUN_SPEED = 13;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = 1.1;

/**
 * Doba w sekundach. Osiem minut, bo doba jest tu **oświetleniem, nie zegarem
 * świata** — harmonogramy NPC przyjdą w M5 i wtedy dostaną własny czas. Do
 * sprawdzenia, czy noc działa, nikt nie będzie czekał dwudziestu minut.
 */
const DAY_SECONDS = 480;
/** ułamek doby, od którego zaczynamy: poranek, żeby pierwsze wrażenie było widoczne */
const START_HOUR = 0.3;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Brak kontekstu 2D');

const screen = new Screen(80, 40);
let metrics = computeMetrics(1, 1, DEFAULT_TARGET_COLS, FONT_STACK, measure);

/**
 * Zasięg i pierścień muszą rosnąć razem. 64 komórki to 128 m — na pustkowiu
 * połowa ekranu pokazuje wtedy pierwsze dziesięć metrów, a reszta ginie we mgle
 * i wszystko sprawia wrażenie przyklejonego do twarzy. Pomiar z M1 §7 mówi, że
 * 200 komórek (400 m) kosztuje 3,8 ms w najgorszej scenie przy budżecie 8 ms,
 * więc płacimy za widok. Pierścień 3 (7×7 chunków) sięga 448 m, czyli dalej niż
 * promienie — inaczej marsz kończyłby się na niezaładowanej pustce.
 */
const world = new ChunkStore(SEED, wildPack, 3);
const render = createRenderContext(compileMaterials(wildPack.materials), {
  cellW: metrics.cellW,
  cellH: metrics.cellH,
  metersPerCell: CELL_METERS,
  maxDepth: 200,
  fogDist: 220,
  ambient: 0.3,
  skyMaterial: wildPack.skyMaterial,
});
render.light.torchRadius = wildPack.light.torchRadius;
render.light.torchPower = wildPack.light.torchPower;

const cam: Camera = {
  x: START_X,
  y: START_Y,
  eyeZ: 0,
  yaw: START_YAW,
  pitch: 0.02,
  fov: (74 * Math.PI) / 180,
};

// pierwszy pierścień budujemy w całości przed pierwszą klatką — inaczej gracz
// widzi pustkę i myśli, że coś się zepsuło
world.loadRing(cam);
// grunt to span zerowy — lista jest posortowana po dolnej krawędzi, więc pierwszy
// span komórki to zawsze teren. Pytanie o „najwyższą czapkę" postawiłoby gracza
// na koronie drzewa, a wtedy każdy sąsiad jest 7 m niżej i nie da się zejść
cam.eyeZ = world.spanTop(Math.floor(cam.x), Math.floor(cam.y), 0) + PLAYER_EYE;
/** wysokość, do której oko dąży; `cam.eyeZ` goni ją płynnie w `frame` */
let eyeTarget = cam.eyeZ;
/** 0..1 — pozycja w dobie; steruje mnożnikiem światła dziennego */
let dayPhase = START_HOUR;
let torchOn = true;

/**
 * Skok do najbliższego wejścia do jaskini i z powrotem — klawisz `G`.
 *
 * Afordancja testowa, nie mechanika: do najbliższego lochu jest z reguły kilkaset
 * metrów, a sprawdzenie zmiany w oświetleniu podziemi nie może kosztować minuty
 * biegu. Wraca tam, skąd skoczyłeś, więc nie gubi kontekstu.
 */
let jumpBack: { x: number; y: number; yaw: number } | null = null;

function jumpToCave(): void {
  if (jumpBack !== null) {
    const back = jumpBack;
    jumpBack = null;
    land(back.x, back.y, back.yaw);
    return;
  }
  // Pełny prostokąt POI wokół gracza; siatka lochów ma skok 512 komórek, więc
  // ±1024 zawsze coś złapie, o ile w ogóle coś tam jest.
  const graphs = dungeonsNear(SEED, cam.x - 1024, cam.y - 1024, cam.x + 1024, cam.y + 1024);
  let best = null;
  let bestD = Infinity;
  for (const g of graphs) {
    const d = (g.mouthX - cam.x) ** 2 + (g.mouthY - cam.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (best === null) return;
  jumpBack = { x: cam.x, y: cam.y, yaw: cam.yaw };
  // kolano wcięcia: stoi się w wąwozie, twarzą do wylotu tunelu
  land(
    best.mouthX + best.mouthDirX * 4 + 0.5,
    best.mouthY + best.mouthDirY * 4 + 0.5,
    Math.atan2(-best.mouthDirY, -best.mouthDirX),
  );
}

function land(x: number, y: number, yaw: number): void {
  cam.x = x;
  cam.y = y;
  cam.yaw = yaw;
  world.loadRing(cam);
  const surf = world.surfaceHeight(Math.floor(x), Math.floor(y), 1e6);
  if (Number.isFinite(surf)) {
    eyeTarget = surf + PLAYER_EYE;
    cam.eyeZ = eyeTarget;
  }
}

function measure(fontPx: number, fontStack: string): number {
  if (!ctx) return fontPx * 0.6;
  ctx.font = `${fontPx}px ${fontStack}`;
  return ctx.measureText('M').width;
}

/**
 * Rozmiar, na który policzone są aktualne metryki. Pilnujemy go **co klatkę**,
 * a nie tylko przy zdarzeniu `resize`: strona otwarta w ukrytej karcie albo
 * w zwiniętym panelu ma `clientWidth` równe zeru, bufor zostaje 1×1 i po
 * pokazaniu okna nic już go nie przelicza — ekran zostaje czarny, mimo że
 * pętla chodzi. Porównanie dwóch liczb na klatkę jest tańsze niż ta pułapka.
 */
let sizedW = 0;
let sizedH = 0;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  sizedW = canvas.clientWidth;
  sizedH = canvas.clientHeight;
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
  if (e.code === 'KeyF') torchOn = !torchOn;
  // skok o pół doby: jedyny sposób zobaczyć noc bez czekania czterech minut
  if (e.code === 'KeyN') dayPhase = (dayPhase + 0.5) % 1;
  if (e.code === 'KeyG') jumpToCave();
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

/**
 * Próba przesunięcia na nową pozycję. Kolizja jest celowo prymitywna — próg,
 * ściana i głębina; reszta to zakres późniejszych zadań.
 */
function tryMove(nx: number, ny: number): void {
  const cx = Math.floor(nx);
  const cy = Math.floor(ny);
  const feet = eyeTarget - PLAYER_EYE;
  const surf = world.surfaceHeight(cx, cy, feet + STEP_UP);
  if (!Number.isFinite(surf)) return; // chunk jeszcze się nie policzył
  if (world.blocks(cx, cy, surf + 0.05, surf + PLAYER_HEIGHT)) return;
  const water = world.waterLevel(cx, cy);
  if (water !== null && water - surf > WADE_DEPTH) return;
  cam.x = nx;
  cam.y = ny;
  eyeTarget = surf + PLAYER_EYE;
}

/**
 * Mnożnik światła dziennego z pozycji w dobie. Dzień trwa mniej więcej połowę
 * doby, świt i zmierzch są krótkie — liniowe zbocza wystarczą, bo różnicy
 * między krzywą a łamaną i tak nie widać na rampie piętnastu poziomów.
 */
function daylightAt(phase: number): number {
  if (phase < 0.2 || phase > 0.8) return 0; // noc
  if (phase < 0.3) return (phase - 0.2) * 10; // świt
  if (phase > 0.7) return (0.8 - phase) * 10; // zmierzch
  return 1;
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
  // osobno w X i Y, żeby dało się ślizgać wzdłuż przeszkody zamiast się w niej kleić
  tryMove(cam.x + mx, cam.y);
  tryMove(cam.x, cam.y + my);
}

/* ---------------- pętla ---------------- */

const HUD_COLOR = pack15(210, 225, 245);
const HUD_DIM = pack15(120, 150, 130);
let prevT = 0;
let fps = 0;

function frame(t: number): void {
  if (canvas.clientWidth !== sizedW || canvas.clientHeight !== sizedH) resize();
  const dt = prevT === 0 ? 0 : Math.min(0.05, (t - prevT) * 0.001);
  prevT = t;
  if (dt > 0) fps += (1 / dt - fps) * 0.1;

  step(dt);
  if (dt > 0) {
    const k = dt * EYE_SMOOTH;
    cam.eyeZ += (eyeTarget - cam.eyeZ) * (k > 1 ? 1 : k);
  }

  dayPhase = (dayPhase + dt / DAY_SECONDS) % 1;
  render.light.daylight = daylightAt(dayPhase);
  // Pochodnia jedzie z okiem, a nie z nogami — inaczej cień własnej sylwetki
  // wychodziłby na ścianę przed graczem. Migotanie liczymy z zegara klatki,
  // więc jest gładkie niezależnie od fps.
  render.light.torchX = cam.x * CELL_METERS;
  render.light.torchY = cam.y * CELL_METERS;
  render.light.torchZ = cam.eyeZ;
  render.light.torchPower = torchOn ? wildPack.light.torchPower : 0;
  render.light.torchFlicker = torchFlicker(t * 0.001);
  // najwyżej jeden chunk na klatkę — pusta krawędź świata jest mniej dotkliwa
  // niż zacinka, a przy prędkości marszu i tak nie zdążymy jej zobaczyć
  world.update(cam);
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
  const biome = wildPack.biomes[world.biomeAtCell(Math.floor(cam.x), Math.floor(cam.y))];
  screen.text(1, 0, `${fps.toFixed(0)} fps  ${screen.cols}x${screen.rows}`, HUD_COLOR);
  screen.text(
    1,
    1,
    `x ${cam.x.toFixed(0)}  y ${cam.y.toFixed(0)}  ${(cam.eyeZ - PLAYER_EYE).toFixed(1)} m n.p.m.  ${biome?.id ?? '?'}`,
    HUD_DIM,
  );
  const hour = Math.floor(dayPhase * 24);
  const minute = Math.floor((dayPhase * 24 - hour) * 60);
  screen.text(
    1,
    2,
    `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}  pochodnia ${torchOn ? 'tak' : 'nie'}`,
    HUD_DIM,
  );
  screen.text(
    1,
    screen.rows - 1,
    'WASD + mysz (klik = pointer lock), Shift = bieg, F = pochodnia, N = pół doby, G = jaskinia',
    HUD_DIM,
  );
}

resize();
requestAnimationFrame(frame);
