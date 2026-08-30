/**
 * Byt: reguły plus miejsce w świecie. Gracz i potwór różnią się tylko tym, kto
 * podejmuje decyzje — dane są te same.
 *
 * Renderer nie zna tego typu (dostaje `SpriteInstance`), a `packages/rules` nie zna
 * renderera. Sklejenie jednego z drugim jest w `apps/game` i tam ma zostać.
 */

import type { Actor } from './actor.js';

/** Stany AI. Ucieczka jest osobnym stanem, a nie wariantem walki — patrz `ai.ts`. */
export const AiState = {
  Idle: 0,
  /** coś usłyszał albo mignęło mu w oku: idzie sprawdzić */
  Suspicious: 1,
  /** widzi cel i zbliża się */
  Hunting: 2,
  /** w zasięgu broni */
  Fighting: 3,
  /** ranny, ucieka */
  Fleeing: 4,
} as const;
export type AiState = (typeof AiState)[keyof typeof AiState];

export interface Being {
  actor: Actor;
  /** pozycja w komórkach świata — ta sama miara co kamera */
  x: number;
  y: number;
  /** metry: wysokość gruntu pod bytem */
  z: number;
  /** radiany: w którą stronę patrzy */
  yaw: number;
  /**
   * Czy byt biegnie. Ustawia to ten, kto nim rusza — gra dla gracza, AI dla potworów.
   * Percepcja czyta to pole u **obserwowanego**, bo hałas jest cechą tego, kto się
   * porusza, a nie tego, kto słucha.
   */
  running: boolean;
  /**
   * Jak jasno byt jest oświetlony, 0..1. Wypełnia to gra przed rysowaniem, bo tę
   * samą liczbę potrzebuje sprite — i dlatego **pochodnia zdradza**: światło niesione
   * przez gracza wchodzi tu tak samo jak światło komnaty, a percepcja czyta stąd,
   * a nie z bajtu komórki.
   */
  lum: number;
  /** indeks w `wildCreatures`; -1 dla gracza */
  kind: number;
  /** metry na sekundę, przepisane z contentu przy tworzeniu */
  walkMps: number;
  runMps: number;

  /* --- stan AI; dla gracza nieużywany --- */
  ai: AiState;
  /** ms w bieżącym stanie — wychodzenie z pościgu jest funkcją czasu, nie losu */
  aiMs: number;
  /** ostatnia znana pozycja celu; tam idzie byt, który stracił go z oczu */
  seenX: number;
  seenY: number;

  /* --- animacja; renderer czyta tylko `frame` --- */
  frame: number;
  frameMs: number;
  /** ms: ile jeszcze trwa klatka wymuszona zdarzeniem (cios, trafienie) */
  holdMs: number;
}

export function makeBeing(actor: Actor, x: number, y: number, z: number, yaw: number, kind: number, walkMps: number, runMps: number): Being {
  return {
    actor,
    x,
    y,
    z,
    yaw,
    running: false,
    lum: 1,
    kind,
    walkMps,
    runMps,
    ai: AiState.Idle,
    aiMs: 0,
    seenX: x,
    seenY: y,
    frame: 0,
    frameMs: 0,
    holdMs: 0,
  };
}
