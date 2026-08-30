import { describe, it, expect } from 'vitest';
import { COMBAT, PLAYER, Weapon, Armor, armors, weapons } from '@rpg/content';
import { Attr, Skill, Stance, makeActor, tickActor, loadFactor } from './actor.js';
import { train } from './progress.js';
import { equipArmor, equipWeapon, protectionOf, totalWeight, weaponOf, FISTS } from './equipment.js';
import { addItem, ItemKind, makeInventory, removeItem } from './inventory.js';

function player() {
  return makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
}

describe('aktor', () => {
  it('hp nie regeneruje się z czasem, wytrzymałość tak', () => {
    const a = player();
    a.hp = 10;
    a.stamina = 0;
    for (let i = 0; i < 60; i++) tickActor(a, 1000);
    expect(a.hp).toBe(10);
    expect(a.stamina).toBe(a.maxStamina);
  });

  it('blok regeneruje wolniej niż stanie', () => {
    const stoi = player();
    const blokuje = player();
    stoi.stamina = 0;
    blokuje.stamina = 0;
    blokuje.stance = Stance.Blocking;
    tickActor(stoi, 1000);
    tickActor(blokuje, 1000);
    expect(blokuje.stamina).toBeLessThan(stoi.stamina);
    expect(blokuje.stamina).toBeCloseTo(COMBAT.staminaRegenBlocking, 5);
  });

  it('postawa wygasa sama, blok trzyma się do puszczenia', () => {
    const a = player();
    a.stance = Stance.Recover;
    a.stanceMs = 300;
    tickActor(a, 400);
    expect(a.stance).toBe(Stance.Idle);

    a.stance = Stance.Blocking;
    a.stanceMs = 0;
    tickActor(a, 400);
    expect(a.stance).toBe(Stance.Blocking);
  });

  it('trup nie regeneruje i nie zmienia postawy', () => {
    const a = player();
    a.stance = Stance.Dead;
    a.stamina = 0;
    tickActor(a, 5000);
    expect(a.stance).toBe(Stance.Dead);
    expect(a.stamina).toBe(0);
  });
});

describe('obciążenie', () => {
  it('do połowy udźwigu nie kosztuje nic, powyżej hamuje regenerację', () => {
    const a = player();
    const cap = (a.attrs[Attr.Str] ?? 0) * COMBAT.carryPerStr;
    a.carriedKg = cap * 0.4;
    expect(loadFactor(a)).toBe(1);
    a.carriedKg = cap * 0.75;
    expect(loadFactor(a)).toBeLessThan(1);
    a.carriedKg = cap;
    expect(loadFactor(a)).toBeCloseTo(COMBAT.overloadRegen, 5);
    // powyżej udźwigu nie schodzi niżej — kara ma spowalniać, nie unieruchamiać
    a.carriedKg = cap * 4;
    expect(loadFactor(a)).toBeCloseTo(COMBAT.overloadRegen, 5);
  });
});

describe('ekwipunek', () => {
  it('bez broni bije pięściami', () => {
    expect(weaponOf(player())).toBe(FISTS);
  });

  it('zmiana broni przenosi wagę między plecakiem a ręką', () => {
    const a = player();
    const inv = makeInventory();
    addItem(inv, ItemKind.Weapon, Weapon.Club, a);
    addItem(inv, ItemKind.Weapon, Weapon.Dagger, a);
    const przed = totalWeight(a);

    // dobycie maczugi: znika z plecaka, pojawia się w ręce — suma bez zmian
    removeItem(inv, 0, a);
    equipWeapon(a, Weapon.Club);
    expect(totalWeight(a)).toBeCloseTo(przed, 5);

    // zamiana na sztylet: maczuga wraca do plecaka
    addItem(inv, ItemKind.Weapon, Weapon.Club, a);
    removeItem(inv, inv.items.findIndex((i) => i.index === Weapon.Dagger), a);
    equipWeapon(a, Weapon.Dagger);
    expect(totalWeight(a)).toBeCloseTo(przed, 5);
    expect(a.carriedKg).toBeCloseTo(weapons[Weapon.Club]!.weightKg, 5);
  });

  it('waga plecaka wynika z listy, a nie z osobnego licznika', () => {
    const a = player();
    const inv = makeInventory();
    addItem(inv, ItemKind.Armor, Armor.Mail, a);
    expect(a.carriedKg).toBeCloseTo(armors[Armor.Mail]!.weightKg, 5);
    removeItem(inv, 0, a);
    expect(a.carriedKg).toBe(0);
  });

  it('zużyty pancerz chroni proporcjonalnie mniej', () => {
    const a = player();
    equipArmor(a, Armor.Mail);
    expect(protectionOf(a)).toBeCloseTo(armors[Armor.Mail]!.protection, 5);
    a.armorWear = 50;
    expect(protectionOf(a)).toBeCloseTo(armors[Armor.Mail]!.protection * 0.5, 5);
    a.armorWear = 100;
    expect(protectionOf(a)).toBe(0);
  });
});

describe('rozwój przez użycie', () => {
  it('przyrost hamuje z poziomem umiejętności', () => {
    const nowicjusz = player();
    const mistrz = player();
    nowicjusz.skills[Skill.Blade] = 0;
    mistrz.skills[Skill.Blade] = COMBAT.growthHalf;
    train(nowicjusz, Skill.Blade, true);
    train(mistrz, Skill.Blade, true);
    expect(mistrz.progress[Skill.Blade]!).toBeCloseTo(nowicjusz.progress[Skill.Blade]! / 2, 4);
  });

  it('pudło uczy słabiej niż trafienie, ale uczy', () => {
    const a = player();
    const b = player();
    train(a, Skill.Dodge, true);
    train(b, Skill.Dodge, false);
    expect(b.progress[Skill.Dodge]!).toBeGreaterThan(0);
    expect(b.progress[Skill.Dodge]!).toBeCloseTo(a.progress[Skill.Dodge]! * COMBAT.growthOnMiss, 4);
  });

  it('umiejętność rośnie o pełne punkty i zatrzymuje się na setce', () => {
    const a = player();
    a.skills[Skill.Blade] = 0;
    let awanse = 0;
    for (let i = 0; i < 20000; i++) if (train(a, Skill.Blade, true)) awanse++;
    expect(a.skills[Skill.Blade]).toBe(100);
    expect(awanse).toBeGreaterThan(0);
    // po osiągnięciu setki nie ma już czego trenować
    expect(train(a, Skill.Blade, true)).toBe(false);
  });

  it('sto punktów kosztuje więcej niż tysiąc udanych użyć', () => {
    // Konkretna liczba jest miarą tempa gry: umiejętność ma rosnąć w godzinach,
    // nie w minutach, i ma to być widać w teście, a nie tylko we wzorze.
    const a = player();
    a.skills[Skill.Blade] = 0;
    let uzycia = 0;
    while ((a.skills[Skill.Blade] ?? 0) < 100 && uzycia < 100000) {
      train(a, Skill.Blade, true);
      uzycia++;
    }
    expect(uzycia).toBeGreaterThan(1000);
    expect(uzycia).toBeLessThan(10000);
  });
});
