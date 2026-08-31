import {
  Screen,
  blit,
  compileMaterials,
  computeMetrics,
  createRenderContext,
  drawSprites,
  renderWorld,
  torchFlicker,
  pack15,
  DEFAULT_TARGET_COLS,
} from '@rpg/core';
import type { Camera } from '@rpg/core';
import { Armor, FEEDBACK, PLAYER, MOVE, Weapon, wildPack } from '@rpg/content';
import {
  CELL_METERS,
  ChunkStore,
  dungeonsNear,
  loadFromStorage,
  mulberry32,
  parse,
  saveSizeBytes,
  saveToStorage,
  serialize,
} from '@rpg/world';
import type { DungeonGraph, GameSave } from '@rpg/world';
import {
  Stance,
  addItem,
  beginAttack,
  beginBlock,
  beginDodge,
  endBlock,
  equipArmor,
  equipWeapon,
  makeActor,
  makeAttackResult,
  makeBeing,
  makeInventory,
  removeItem,
  serviceSwing,
  stepCombat,
  Swing,
  syncWeight,
  weaponOf,
  ItemKind,
} from '@rpg/rules';
import {
  bar,
  drawCharacter,
  drawDeath,
  drawInventory,
  drawLog,
  dimScreen,
  makeEventLog,
  pushEvent,
  tickLog,
  EventKind,
  UI,
} from '@rpg/ui';
import { Bestiary, aiLabel, animate } from './entities.js';
import type { MobReport } from './entities.js';

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
 * Piksele: pojedyncze zdarzenie myszy większe niż to jest **artefaktem pointer
 * locka**, nie ruchem ręki, i jest odrzucane w całości.
 *
 * To odrzucanie wartości odstających, a nie filtr — ruch nie jest niczym
 * uśredniany ani wygładzany, bo to psuje celowanie i wyszłoby w M3 przy walce.
 * Zdarzenie mieszczące się w progu trafia do kamery bez zmian.
 *
 * Skala: przy `MOUSE_SENS` 0,0022 rad/px próg 200 px to jednorazowy obrót o 25°.
 * Zgłoszony objaw „obrót o 90-180 stopni" wymagałby 700-1400 px w jednym
 * zdarzeniu, czyli wartości, której ręka nie wytworzy przy 60 klatkach na sekundę.
 * HUD pokazuje rozkład i licznik odrzuceń, żeby ten próg dało się sprawdzić
 * pomiarem zamiast wiarą — patrz `mouseStats`.
 */
const MOUSE_JUMP = 200;

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


/* ---------------- postać, byty, zapis ---------------- */

/**
 * Gracz jest takim samym bytem jak goblin — różni się tym, kto podejmuje decyzje.
 * Pozycję trzyma kamera i to ona jest źródłem prawdy; `player` ją tylko odzwierciedla,
 * bo reguły i percepcja potrzebują bytu, a nie kamery.
 */
const player = makeBeing(
  makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills),
  cam.x,
  cam.y,
  cam.eyeZ - PLAYER_EYE,
  cam.yaw,
  -1,
  MOVE.walkMps,
  MOVE.runMps,
);
equipWeapon(player.actor, Weapon.Shortsword);
equipArmor(player.actor, Armor.Leather);

const pack = makeInventory();
addItem(pack, ItemKind.Weapon, Weapon.Dagger, player.actor);
addItem(pack, ItemKind.Weapon, Weapon.Club, player.actor);
addItem(pack, ItemKind.Armor, Armor.Mail, player.actor);

const bestiary = new Bestiary(SEED, world);
const attack = makeAttackResult();
/** Losowość walki. Osobny strumień od świata, żeby ruch gracza nie zmieniał terenu. */
const combatRng = mulberry32(SEED ^ 0x00c0ffee);
const mobReport: MobReport = {
  damage: 0,
  swung: false,
  blocked: false,
  dodged: false,
  missed: false,
  whiffed: false,
};
/** ile żagwi świeci w tej klatce — do HUD-u, bo limit zestawu jest cichy */
let zrodel = 0;
/** ms: ile jeszcze trwa reakcja kadru na oberwanie (przyciemnienie + drganie) */
let hurtMs = 0;
/** dziennik zdarzeń walki — dwie–trzy linijki gasnące po sekundzie */
const events = makeEventLog();

/** Który panel jest otwarty. Panel przejmuje klawiaturę i zwalnia pointer lock. */
const Panel = { None: 0, Inventory: 1, Character: 2, Dead: 3 } as const;
let panel: number = Panel.None;
let cursor = 0;
let deathCause = '';
/** czy w przeglądarce leży zapis — ekran śmierci pokazuje z tego inną podpowiedź */
let hasSave = loadFromStorage(localStorage) !== null;

function note(text: string, kind: EventKind = EventKind.Neutral): void {
  pushEvent(events, text, kind);
}

/**
 * Reakcja kadru na oberwanie: przyciemnienie i drganie, oba krótkie. Drganie
 * **nie rusza `cam.yaw`** — jest doliczane wyłącznie na czas rysowania, bo inaczej
 * trafienie przesuwałoby celownik i psuło następny cios gracza. To ta sama zasada,
 * przez którą odrzuciliśmy wygładzanie myszy w M2c: nic, co rusza celowaniem.
 */
function shakeAt(t: number): number {
  if (hurtMs <= 0) return 0;
  const faza = hurtMs / FEEDBACK.shakeMs;
  return Math.sin(t * 0.001 * FEEDBACK.shakeHz * Math.PI * 2) * FEEDBACK.shakeAmp * faza;
}



function openPanel(which: number): void {
  panel = which;
  cursor = 0;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/* ---------------- zapis ---------------- */

function snapshot(): GameSave {
  const a = player.actor;
  return {
    version: 1,
    seed: SEED,
    clock: dayPhase * 24 * 60,
    cellDeltas: {},
    flags: {},
    player: {
      x: cam.x,
      y: cam.y,
      z: player.z,
      yaw: cam.yaw,
      pitch: cam.pitch,
      hp: a.hp,
      maxHp: a.maxHp,
      stamina: a.stamina,
      maxStamina: a.maxStamina,
      attrs: Array.from(a.attrs),
      skills: Array.from(a.skills),
      progress: Array.from(a.progress),
      weapon: a.weapon,
      armor: a.armor,
      weaponWear: a.weaponWear,
      armorWear: a.armorWear,
      items: pack.items.map((i) => [i.kind, i.index] as [number, number]),
    },
    entities: bestiary.toSave(),
  };
}

function saveGame(): void {
  const save = snapshot();
  if (saveToStorage(localStorage, save)) {
    hasSave = true;
    note(`zapisano (${(saveSizeBytes(save) / 1024).toFixed(1)} kB)`);
  } else {
    note('zapis się nie udał');
  }
}

/**
 * Eksport do pliku. Na Vercelu nie ma backendu, więc jedyny trwały nośnik poza
 * `localStorage` to plik na dysku gracza — a `localStorage` znika razem z wyczyszczeniem
 * danych witryny, czego gracz robiący porządki nie wiąże z utratą stu godzin gry.
 */
function exportSave(): void {
  const text = serialize(snapshot());
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ascii-rpg-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  note('wyeksportowano do pliku');
}

/** Import z pliku: ten sam `parse`, więc uszkodzony plik daje komunikat, a nie awarię. */
function importSave(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      const save = parse(text);
      if (save === null) {
        note('plik nie jest zapisem tej gry');
        return;
      }
      saveToStorage(localStorage, save);
      hasSave = true;
      loadGame();
    });
  });
  input.click();
}

function loadGame(): void {
  const save = loadFromStorage(localStorage);
  if (save === null) {
    note('brak zapisu');
    return;
  }
  const p = save.player;
  const a = player.actor;
  a.hp = p.hp;
  a.maxHp = p.maxHp;
  a.stamina = p.stamina;
  a.maxStamina = p.maxStamina;
  for (let i = 0; i < a.attrs.length; i++) a.attrs[i] = p.attrs[i] ?? 40;
  for (let i = 0; i < a.skills.length; i++) a.skills[i] = p.skills[i] ?? 0;
  for (let i = 0; i < a.progress.length; i++) a.progress[i] = p.progress[i] ?? 0;
  a.weapon = p.weapon;
  a.armor = p.armor;
  a.weaponWear = p.weaponWear;
  a.armorWear = p.armorWear;
  a.stance = Stance.Idle;
  a.stanceMs = 0;
  pack.items.length = 0;
  for (const [kind, index] of p.items) pack.items.push({ kind: kind as 0 | 1, index });
  syncWeight(pack, a);
  dayPhase = (save.clock / (24 * 60)) % 1;
  bestiary.restore(save.entities);
  panel = Panel.None;
  land(p.x, p.y, p.yaw);
  cam.pitch = p.pitch;
  note('wczytano zapis');
}

/* ---------------- walka ---------------- */

/**
 * Cios gracza rozstrzyga się przeciw najbliższemu żywemu bytowi. `stepCombat`
 * musi biec **co klatkę**, także wtedy, gdy nie ma na kogo trafić — inaczej zamach
 * w powietrze nigdy się nie kończy i postać zostaje zablokowana w zamachu.
 */
function playerCombat(dtMs: number): void {
  const target = bestiary.nearest(cam.x, cam.y);
  if (target === null) {
    // `stepCombat` musi biec co klatkę także wtedy, gdy nie ma w co trafić —
    // inaczej zamach w powietrze nigdy się nie kończy
    stepCombat(player.actor, dtMs);
    return;
  }
  const cios = serviceSwing(player, target.being, dtMs, combatRng, attack, CELL_METERS);
  if (cios === Swing.None) return;
  if (cios !== Swing.Resolved) {
    // Cios doszedł, ale nie miał kogo dosięgnąć. To jest wynik, a nie brak wyniku —
    // bez tego wpisu gracz nie odróżnia „za daleko" od „nic się nie stało".
    note(cios === Swing.OutOfReach ? 'cios w powietrze — za daleko' : 'cios w powietrze', EventKind.Neutral);
    return;
  }

  if (attack.killed) {
    bestiary.markHit(target);
    note('goblin pada', EventKind.Good);
  } else if (attack.blocked) {
    bestiary.markBlocked(target);
    note('goblin zablokował', EventKind.Neutral);
  } else if (attack.dodged) {
    note('goblin uskoczył', EventKind.Neutral);
  } else if (attack.landed) {
    bestiary.markHit(target);
    note(attack.staggered ? 'trafiony, zachwiał się' : 'trafiony', EventKind.Good);
  } else {
    note('pudło', EventKind.Neutral);
  }
}

/**
 * Skok do najbliższego wejścia do jaskini i z powrotem — klawisz `G`.
 *
 * Afordancja testowa, nie mechanika: do najbliższego lochu jest z reguły kilkaset
 * metrów, a sprawdzenie zmiany w oświetleniu podziemi nie może kosztować minuty
 * biegu. Wraca tam, skąd skoczyłeś, więc nie gubi kontekstu.
 */
let jumpBack: { x: number; y: number; yaw: number } | null = null;
/** loch, po którym chodzimy klawiszem `G`, i przystanek w nim (0 = wejście) */
let caveGraph: DungeonGraph | null = null;
let caveStop = 0;

function jumpToCave(): void {
  // Trzy przystanki, nie dwa: wejście → komora → powrót. Komora doszła w M3d,
  // bo zawartość lochu (mieszkańcy, żagwie) zaczyna się dopiero pod stropem,
  // a dojście tam od wejścia to kilkanaście sekund biegu przy każdym sprawdzeniu.
  if (jumpBack !== null && caveGraph !== null && caveStop === 0) {
    const g = caveGraph;
    // najgłębsza komora: tam kończy się loch i tam warto zajrzeć najpierw
    let best = g.rooms[0];
    for (const r of g.rooms) {
      if (best === undefined || r.level > best.level) best = r;
    }
    if (best !== undefined) {
      caveStop = 1;
      land(best.x + best.w / 2, best.y + best.h / 2, 0, best.ceilZ);
      return;
    }
  }
  if (jumpBack !== null) {
    const back = jumpBack;
    jumpBack = null;
    caveGraph = null;
    caveStop = 0;
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
  caveGraph = best;
  caveStop = 0;
  // kolano wcięcia: stoi się w wąwozie, twarzą do wylotu tunelu
  land(
    best.mouthX + best.mouthDirX * 4 + 0.5,
    best.mouthY + best.mouthDirY * 4 + 0.5,
    Math.atan2(-best.mouthDirY, -best.mouthDirX),
  );
}

/**
 * Stawia gracza w podanym miejscu. `maxZ` jest pułapem szukania gruntu i jest
 * konieczny przy skoku do komory lochu: bez niego `surfaceHeight` znajduje
 * najwyższą czapkę, czyli **łąkę nad lochem**, i teleport ląduje na trawie
 * zamiast pod ziemią.
 */
function land(x: number, y: number, yaw: number, maxZ = 1e6): void {
  cam.x = x;
  cam.y = y;
  cam.yaw = yaw;
  world.loadRing(cam);
  const surf = world.surfaceHeight(Math.floor(x), Math.floor(y), maxZ);
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
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') e.preventDefault();

  // Panel przejmuje klawiaturę w całości: gracz, który omyłkiem biegnie
  // z otwartym plecakiem, to najprostszy sposób na śmierć bez własnej winy.
  if (panel !== Panel.None) {
    panelKey(e.code);
    return;
  }

  if (e.code === 'KeyF') torchOn = !torchOn;
  // skok o pół doby: jedyny sposób zobaczyć noc bez czekania czterech minut
  if (e.code === 'KeyN') dayPhase = (dayPhase + 0.5) % 1;
  if (e.code === 'KeyG') jumpToCave();
  if (e.code === 'KeyI') openPanel(Panel.Inventory);
  if (e.code === 'KeyC') openPanel(Panel.Character);
  if (e.code === 'F5') {
    e.preventDefault();
    saveGame();
  }
  if (e.code === 'F9') {
    e.preventDefault();
    loadGame();
  }
  if (e.code === 'F6') {
    e.preventDefault();
    exportSave();
  }
  if (e.code === 'F7') {
    e.preventDefault();
    importSave();
  }
  if (e.code === 'Space' && !beginDodge(player.actor) && player.actor.stance === Stance.Idle) {
    note('brak wytrzymałości na unik', EventKind.Bad);
  }
});

/** Klawisze paneli. Osobna funkcja, bo panel to inny tryb gry, a nie inny widok. */
function panelKey(code: string): void {
  if (panel === Panel.Dead) {
    if (code === 'KeyR' && hasSave) loadGame();
    return;
  }
  if (code === 'KeyQ' || code === 'Escape' || code === 'KeyI' || code === 'KeyC') {
    panel = Panel.None;
    return;
  }
  if (panel !== Panel.Inventory) return;
  if (code === 'ArrowUp') cursor = Math.max(0, cursor - 1);
  if (code === 'ArrowDown') cursor = Math.min(pack.items.length - 1, cursor + 1);
  if (code === 'Enter') equipAt(cursor);
}

/**
 * Zakłada przedmiot spod kursora. Dotychczasowy wraca do plecaka, więc waga się
 * zgadza bez osobnego licznika — `syncWeight` jest jedynym miejscem, które ją ustawia.
 */
function equipAt(index: number): void {
  const it = pack.items[index];
  if (it === undefined) return;
  const a = player.actor;
  const previous = it.kind === ItemKind.Weapon ? a.weapon : a.armor;
  removeItem(pack, index, a);
  if (previous !== null) addItem(pack, it.kind, previous, a);
  if (it.kind === ItemKind.Weapon) equipWeapon(a, it.index);
  else equipArmor(a, it.index);
  cursor = Math.min(cursor, Math.max(0, pack.items.length - 1));
}
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
canvas.addEventListener('click', () => {
  if (panel === Panel.None && document.pointerLockElement !== canvas) {
    void canvas.requestPointerLock();
  }
});
// prawy przycisk trzyma blok, więc menu kontekstowe musi zniknąć
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (panel !== Panel.None || document.pointerLockElement !== canvas) return;
  // Odmowa akcji musi być widoczna w tej samej klatce, w której padła. Kliknięcie,
  // po którym nie dzieje się nic, gracz czyta jako zgubione wejście, a nie jako
  // karę za własną decyzję — i przestaje ufać sterowaniu.
  if (e.button === 0 && !beginAttack(player.actor)) {
    if (player.actor.stamina < weaponOf(player.actor).stamina) {
      note('brak wytrzymałości', EventKind.Bad);
    }
  }
  if (e.button === 2) beginBlock(player.actor);
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 2) endBlock(player.actor);
});
/**
 * Rozkład |movement| w kubełkach dwójkowych: <2, <8, <32, <128, <512, reszta.
 * Histogram zamiast listy próbek, bo ma być darmowy i bez alokacji — a do pytania
 * „czy maksimum jest o rzędy wielkości większe od reszty" kubełki wystarczą.
 */
const mouseBuckets = new Int32Array(6);
let mouseMax = 0;
let mouseDropped = 0;
/**
 * Pierwsze zdarzenie po wejściu w pointer lock niesie deltę od pozycji kursora
 * sprzed zablokowania, a nie ruch ręki. Po alt-tabie albo przełączeniu monitora
 * bywa to kilkaset pikseli i to jest drugie źródło skoku kamery.
 */
let skipNextMove = false;

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) skipNextMove = true;
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const mx = e.movementX;
  const my = e.movementY;
  const big = Math.max(Math.abs(mx), Math.abs(my));
  if (big > mouseMax) mouseMax = big;
  const b = big < 2 ? 0 : big < 8 ? 1 : big < 32 ? 2 : big < 128 ? 3 : big < 512 ? 4 : 5;
  mouseBuckets[b] = (mouseBuckets[b] ?? 0) + 1;

  if (skipNextMove) {
    skipNextMove = false;
    mouseDropped++;
    return;
  }
  if (big > MOUSE_JUMP) {
    mouseDropped++;
    return;
  }

  cam.yaw += mx * MOUSE_SENS;
  cam.pitch -= my * MOUSE_SENS;
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
  // Ciała są nieprzenikalne. Bez tego gracz wchodził w potwora (zmierzone 0,00 m
  // dystansu), a odsuwający się byt wyglądał, jakby dawał się przepychać.
  if (bestiary.occupied(nx, ny, MOVE.bodyRadiusM * 2)) return;
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

  const dtMs = dt * 1000;
  const zyje = player.actor.stance !== Stance.Dead;
  if (panel === Panel.None && zyje) step(dt);
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

  // Byt gracza idzie za kamerą: pozycja ma jedno źródło prawdy, a reguły
  // i percepcja i tak potrzebują bytu, nie kamery.
  player.x = cam.x;
  player.y = cam.y;
  player.z = eyeTarget - PLAYER_EYE;
  player.yaw = cam.yaw;
  player.running = (keys['ShiftLeft'] || keys['ShiftRight']) === true;
  player.lum = bestiary.lumAt(render.light, cam.x, cam.y, player.z);

  if (zyje && panel !== Panel.Inventory && panel !== Panel.Character) {
    // bieg kosztuje wytrzymałość, inaczej nie ma powodu chodzić
    if (player.running) {
      player.actor.stamina = Math.max(
        0,
        player.actor.stamina - MOVE.runStaminaPerSec * dt,
      );
    }
    bestiary.spawnAround(cam.x, cam.y, player.z);
    playerCombat(dtMs);
    animate(player, { vx: 0, vy: 0, running: player.running }, dtMs);
    bestiary.step(player, dtMs, render.light, combatRng, attack, mobReport);
    if (mobReport.damage > 0) {
      hurtMs = FEEDBACK.hurtDimMs;
      note('oberwałeś', EventKind.Bad);
    } else if (mobReport.blocked) {
      note('zablokowane', EventKind.Good);
    } else if (mobReport.dodged) {
      note('uskoczyłeś', EventKind.Good);
    } else if (mobReport.missed) {
      note('minął cię', EventKind.Neutral);
    } else if (mobReport.whiffed) {
      // zamach, który nie miał czego dosięgnąć — też jest informacją: byłeś poza
      // zasięgiem jego pałki, więc ten moment jest twoją okazją
      note('goblin machnął w powietrze', EventKind.Neutral);
    }
    if (player.actor.hp <= 0 && player.actor.stance === Stance.Dead) {
      deathCause = 'zabity przez goblina';
      openPanel(Panel.Dead);
    }
  }
  tickLog(events, dtMs);

  // Drganie doliczamy wyłącznie na czas rysowania i zaraz cofamy — `cam` zostaje
  // źródłem prawdy o tym, gdzie gracz celuje.
  const drgania = shakeAt(t);
  const yaw0 = cam.yaw;
  const pitch0 = cam.pitch;
  cam.yaw += drgania;
  cam.pitch += drgania * 0.5;
  // Żagwie lochu: najbliższe źródła trafiają do zestawu przed renderem. Zestaw ma
  // twardy limit ośmiu, więc wybór jest po odległości, a nie po kolejności w liście.
  zrodel = bestiary.feedLights(render.light, cam.x, cam.y);
  renderWorld(world, cam, screen, render);
  drawSprites(screen, cam, render, bestiary.spriteList(), bestiary.mobs.length);
  cam.yaw = yaw0;
  cam.pitch = pitch0;

  if (hurtMs > 0) {
    // im bliżej końca efektu, tym jaśniej — przyciemnienie ma zakłuć, nie oślepić
    const faza = hurtMs / FEEDBACK.hurtDimMs;
    // po świecie i sprite'ach, a przed HUD-em: przyciemnienie dotyczy obrazu,
    // a nie wskaźników, które w tym momencie są najbardziej potrzebne
    dimScreen(screen, 1 - (1 - FEEDBACK.hurtDim) * faza);
    hurtMs -= dtMs;
  }

  drawHud();
  if (panel === Panel.Inventory) drawInventory(screen, player.actor, pack, cursor);
  else if (panel === Panel.Character) drawCharacter(screen, player.actor);
  else if (panel === Panel.Dead) drawDeath(screen, deathCause, dayPhase * 24, hasSave);
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
    `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}  pochodnia ${torchOn ? 'tak' : 'nie'}  żagwie ${zrodel}  byty ${bestiary.mobs.length}`,
    HUD_DIM,
  );
  // Pomiar rozkładu ruchu myszy: kubełki, maksimum i licznik odrzuceń. Zostaje
  // w HUD, bo próg `MOUSE_JUMP` jest dobrany z mechanizmu, a nie z pomiaru na tej
  // maszynie — trzydzieści sekund gry plus alt-tab wystarczy, żeby go zweryfikować.
  screen.text(
    1,
    3,
    `mysz ${mouseBuckets.join('/')}  max ${mouseMax}  odrzucone ${mouseDropped}`,
    HUD_DIM,
  );
  screen.text(
    1,
    screen.rows - 1,
    'WASD, LPM cios, PPM blok, Spacja unik, I plecak, C karta, F5/F9 zapis, F6/F7 plik, F pochodnia, G jaskinia/komora',
    HUD_DIM,
  );

  drawVitals();
}

/**
 * Paski życia i wytrzymałości w lewym dolnym rogu, w tym samym buforze co świat.
 * Liczby stoją obok pasków, bo przy walce w czasie rzeczywistym pasek mówi „ile
 * zostało", a liczba — „czy zdążę jeszcze jeden cios".
 */
function drawVitals(): void {
  const a = player.actor;
  const y = screen.rows - 4;
  screen.text(1, y, 'ZDR', UI.dim);
  bar(screen, 5, y, 22, a.hp, a.maxHp, hurtMs > 0 ? UI.text : UI.bad);
  screen.text(28, y, `${Math.ceil(a.hp)}/${a.maxHp}`, HUD_COLOR);

  screen.text(1, y + 1, 'WYT', a.exhausted ? UI.bad : UI.dim);
  bar(screen, 5, y + 1, 22, a.stamina, a.maxStamina, a.exhausted ? UI.bad : UI.good);

  if (a.exhausted) {
    // Stan trwa aż do progu wyjścia i jest widoczny poza samym paskiem — moment
    // wyczerpania jest najważniejszą chwilą walki i nie może wymagać wpatrywania
    // się w słupek.
    screen.text(1, y, 'ZDR', UI.dim);
    screen.text(28, y + 1, 'WYCZERPANY', UI.bad);
  }

  const stan =
    a.stance === Stance.Windup
      ? 'zamach'
      : a.stance === Stance.Recover
        ? 'odbicie'
        : a.stance === Stance.Blocking
          ? 'blok'
          : a.stance === Stance.Dodging
            ? 'unik'
            : a.stance === Stance.Stagger
              ? 'wytrącony'
              : '';
  if (stan !== '') screen.text(28, y + 1, stan, UI.accent);

  const near = bestiary.nearest(cam.x, cam.y);
  if (near !== null) {
    const d = Math.hypot(near.being.x - cam.x, near.being.y - cam.y) * CELL_METERS;
    if (d < 40) {
      screen.text(
        1,
        y + 2,
        `goblin ${d.toFixed(0)} m  ${aiLabel(near.being.ai)}  ${Math.ceil(near.being.actor.hp)} hp`,
        d < 4 ? UI.bad : HUD_DIM,
      );
    }
  }
  // Dziennik rośnie w GÓRĘ od wiersza nad wskaźnikami: w dół nie ma miejsca,
  // bo tam stoi linia pomocy, a nachodzenie dwóch tekstów na siebie czyta się
  // jak błąd renderu.
  drawLog(screen, 1, y - 2, events);
}

resize();
requestAnimationFrame(frame);
