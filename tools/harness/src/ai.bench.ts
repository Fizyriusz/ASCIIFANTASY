import { bench, describe } from 'vitest';
import { PLAYER, wildCreatures } from '@rpg/content';
import { mulberry32 } from '@rpg/world';
import { equipWeapon, makeActor, makeBeing, makeIntent, updateAi } from '@rpg/rules';
import type { Being, Intent } from '@rpg/rules';
import { DUNGEON_VIEWS, dungeonScene } from './scene.js';

/**
 * Koszt AI przy sześćdziesięciu bytach — tej samej liczbie, którą DoD M3 stawia
 * rendererowi. Percepcja marszem po siatce jest tu najdroższa, więc mierzymy ją
 * na scenie z geometrią, a nie na pustej hali.
 */
const s = dungeonScene('corridor');
const v = DUNGEON_VIEWS.corridor;
const rng = mulberry32(5);
const gracz = makeBeing(
  makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills),
  v.x,
  v.y,
  s.store.spanTop(Math.floor(v.x), Math.floor(v.y), 0),
  v.yaw,
  -1,
  1.9,
  4.4,
);
gracz.lum = 0.9;

const def = wildCreatures[0];
if (def === undefined) throw new Error('paczka bez potworów');
const mobs: { being: Being; intent: Intent }[] = [];
for (let i = 0; i < 60; i++) {
  const a = makeActor(def.hp, 60, def.attrs, def.skills);
  equipWeapon(a, def.weapon);
  const x = v.x + Math.cos(v.yaw) * (3 + (i % 20)) + ((i % 3) - 1);
  const y = v.y + Math.sin(v.yaw) * (3 + (i % 20)) + ((i % 5) - 2);
  const b = makeBeing(a, x, y, s.store.spanTop(Math.floor(x), Math.floor(y), 0), v.yaw + Math.PI, 0, def.walkMps, def.runMps);
  b.lum = 0.5;
  mobs.push({ being: b, intent: makeIntent() });
}

describe('ai', () => {
  bench('updateAi, 60 bytów', () => {
    for (const m of mobs) updateAi(m.being, gracz, s.store, 16, rng, m.intent, 2);
  });
});
