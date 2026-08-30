export {
  Attr,
  Skill,
  Stance,
  ATTR_COUNT,
  SKILL_COUNT,
  makeActor,
  isAlive,
  tickActor,
  loadFactor,
} from './actor.js';
export type { Actor } from './actor.js';
export { train } from './progress.js';
export {
  FISTS,
  weaponOf,
  armorOf,
  protectionOf,
  weaponWearFactor,
  equipWeapon,
  equipArmor,
  totalWeight,
} from './equipment.js';
export {
  beginAttack,
  beginBlock,
  endBlock,
  beginDodge,
  stepCombat,
  resolveAttack,
  hitChance,
  defenseOf,
  makeAttackResult,
} from './combat.js';
export type { AttackResult } from './combat.js';
