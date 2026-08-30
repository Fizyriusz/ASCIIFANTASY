/**
 * Rozwój przez użycie: umiejętność rośnie od tego, co robisz, a nie od punktów
 * rozdawanych po awansie. Przyrost hamuje logarytmicznie — przy `growthHalf` jest
 * połową bazowego, przy setce prawie zerowy.
 *
 * Nieudana próba też uczy, tylko słabiej (`growthOnMiss`). Bez tego najlepszą
 * strategią rozwoju jest bicie najsłabszego przeciwnika w grze, bo tylko trafienia
 * dają postęp — a to jest dokładnie ta pętla, której nie chcemy nagradzać.
 */

import { COMBAT } from '@rpg/content';
import type { Actor, Skill } from './actor.js';

/**
 * Dopisuje postęp i zwraca `true`, gdy umiejętność urosła o pełny punkt — z tego
 * wywołujący robi wpis w dzienniku. Nie alokuje niczego, bo wywoływane jest
 * z pętli walki.
 */
export function train(a: Actor, skill: Skill, success: boolean): boolean {
  const cur = a.skills[skill] ?? 0;
  if (cur >= 100) return false;
  const gain =
    (COMBAT.growthBase / (1 + cur / COMBAT.growthHalf)) * (success ? 1 : COMBAT.growthOnMiss);
  const acc = (a.progress[skill] ?? 0) + gain;
  if (acc >= 1) {
    const whole = Math.floor(acc);
    a.skills[skill] = Math.min(100, cur + whole);
    a.progress[skill] = acc - whole;
    return true;
  }
  a.progress[skill] = acc;
  return false;
}
