/**
 * AI: pięć stanów i `switch`. Bez drzew zachowań, bez systemu zdarzeń — dwieście
 * bytów w tablicy tego nie potrzebuje, a każde z tych narzędzi kosztuje więcej kodu
 * niż całe zachowanie, które opisuje.
 *
 * Najważniejszy stan to `Fleeing`. Przeciwnik walczący do śmierci jest nudny
 * i sprawia, że świat wydaje się mechaniczny — ranny goblin, który ucieka
 * korytarzem, robi dla wrażenia żywego świata więcej niż dowolny pathfinding.
 *
 * AI **nie porusza bytem**: zapisuje zamiar do `vx`/`vy` (komórki na sekundę),
 * a przesunięcie z kolizją wykonuje `apps/game` tym samym kodem, którym rusza
 * graczem. Inaczej reguły musiałyby znać geometrię świata.
 */

import { MOVE, PERCEPTION } from '@rpg/content';
import { Stance } from './actor.js';
import { AiState } from './being.js';
import type { Being } from './being.js';
import { beginAttack, beginBlock, endBlock, resolveAttack, stepCombat } from './combat.js';
import type { AttackResult } from './combat.js';
import { weaponOf } from './equipment.js';
import { canHear, canSee } from './perception.js';
import type { SightGrid } from './perception.js';

/** Zamiar ruchu jednego bytu w tej klatce. Jeden obiekt na byt, nie na klatkę. */
export interface Intent {
  /** komórki na sekundę */
  vx: number;
  vy: number;
  /** czy byt biegnie — z tego wynika hałas i koszt wytrzymałości */
  running: boolean;
}

export function makeIntent(): Intent {
  return { vx: 0, vy: 0, running: false };
}

/**
 * Obraca byt w stronę punktu, najwyżej o `MOVE.turnRate` na sekundę. Skokowy obrót
 * na cel wygląda jak teleport głowy i psuje wybór kierunku sprite'a.
 */
function turnTowards(b: Being, tx: number, ty: number, dtMs: number): void {
  const want = Math.atan2(ty - b.y, tx - b.x);
  let diff = want - b.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const max = MOVE.turnRate * (dtMs / 1000);
  if (diff > max) diff = max;
  else if (diff < -max) diff = -max;
  b.yaw += diff;
}

function moveTowards(b: Being, tx: number, ty: number, mps: number, out: Intent, metersPerCell: number): void {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;
  const cells = mps / metersPerCell;
  out.vx = (dx / len) * cells;
  out.vy = (dy / len) * cells;
}

/**
 * Rozstrzyga cios bytu, jeśli właśnie doszedł. Zasięg sprawdza się **tutaj**, a nie
 * w `resolveAttack`, bo reguły walki nie znają pozycji — i dzięki temu ten sam kod
 * obsługuje gracza i potwora.
 */
export function serviceSwing(
  self: Being,
  foe: Being,
  dtMs: number,
  rng: () => number,
  out: AttackResult,
  metersPerCell: number,
): boolean {
  if (!stepCombat(self.actor, dtMs)) return false;
  const dx = foe.x - self.x;
  const dy = foe.y - self.y;
  const distM = Math.sqrt(dx * dx + dy * dy) * metersPerCell;
  // zasięg broni plus pół metra na objętość obu ciał
  if (distM > weaponOf(self.actor).reachM + 0.5) return false;
  const kat = Math.atan2(dy, dx) - self.yaw;
  // cios idzie do przodu; obrót w trakcie zamachu nie naprowadza go na cel
  if (Math.abs(Math.atan2(Math.sin(kat), Math.cos(kat))) > 0.9) return false;
  resolveAttack(self.actor, foe.actor, rng, out);
  return true;
}

/**
 * Jeden krok AI. `player` jest jedynym celem, bo w M3 potwory nie walczą ze sobą —
 * to jest świadome ograniczenie, nie przeoczenie: wrogość między frakcjami wymaga
 * frakcji, a te są w M4.
 */
export function updateAi(
  self: Being,
  player: Being,
  grid: SightGrid,
  dtMs: number,
  rng: () => number,
  out: Intent,
  metersPerCell: number,
): void {
  out.vx = 0;
  out.vy = 0;
  out.running = false;
  const a = self.actor;
  if (a.stance === Stance.Dead) return;

  self.aiMs += dtMs;

  const widzi = canSee(self, player, grid, metersPerCell);
  const slyszy = canHear(self, player, metersPerCell);
  if (widzi) {
    self.seenX = player.x;
    self.seenY = player.y;
  } else if (slyszy && self.ai === AiState.Idle) {
    self.seenX = player.x;
    self.seenY = player.y;
  }

  const dx = player.x - self.x;
  const dy = player.y - self.y;
  const distM = Math.sqrt(dx * dx + dy * dy) * metersPerCell;
  const reach = weaponOf(a).reachM + 0.5;

  // Ucieczka wygrywa ze wszystkim innym: ranny byt nie kalkuluje, czy zdąży trafić.
  if (a.hp <= a.maxHp * PERCEPTION.fleeHpFraction) enter(self, AiState.Fleeing);

  switch (self.ai) {
    case AiState.Idle:
      if (widzi) enter(self, AiState.Hunting);
      else if (slyszy) enter(self, AiState.Suspicious);
      break;

    case AiState.Suspicious:
      turnTowards(self, self.seenX, self.seenY, dtMs);
      moveTowards(self, self.seenX, self.seenY, self.walkMps, out, metersPerCell);
      if (widzi) enter(self, AiState.Hunting);
      else if (self.aiMs > PERCEPTION.searchMs) enter(self, AiState.Idle);
      break;

    case AiState.Hunting:
      turnTowards(self, self.seenX, self.seenY, dtMs);
      if (distM <= reach && widzi) {
        enter(self, AiState.Fighting);
      } else {
        moveTowards(self, self.seenX, self.seenY, self.runMps, out, metersPerCell);
        out.running = true;
        // stracony z oczu i dobiegł tam, gdzie go widział — szuka jeszcze chwilę
        if (!widzi && Math.abs(self.x - self.seenX) < 0.5 && Math.abs(self.y - self.seenY) < 0.5) {
          enter(self, AiState.Suspicious);
        }
      }
      break;

    case AiState.Fighting: {
      turnTowards(self, player.x, player.y, dtMs);
      if (distM > reach * 1.6 || !widzi) {
        enter(self, AiState.Hunting);
        break;
      }
      if (a.stance === Stance.Idle) {
        // trzy czwarte ciosów, reszta to blok — przeciwnik, który tylko bije,
        // uczy gracza jednego ruchu i przestaje być groźny
        if (rng() < 0.75) {
          if (!beginAttack(a)) beginBlock(a);
        } else {
          beginBlock(a);
        }
      } else if (a.stance === Stance.Blocking && rng() < 0.15) {
        endBlock(a);
      }
      break;
    }

    case AiState.Fleeing:
      endBlock(a);
      turnTowards(self, self.x - dx, self.y - dy, dtMs);
      moveTowards(self, self.x - dx, self.y - dy, self.runMps, out, metersPerCell);
      out.running = true;
      // odbiegł dość daleko i odpoczął — wraca do czuwania, a nie do walki
      if (distM > PERCEPTION.sightM && a.hp > a.maxHp * PERCEPTION.fleeHpFraction) {
        enter(self, AiState.Idle);
      }
      break;
  }

  self.running = out.running;
}

function enter(b: Being, state: AiState): void {
  if (b.ai === state) return;
  b.ai = state;
  b.aiMs = 0;
}
