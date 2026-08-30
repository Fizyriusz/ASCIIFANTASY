import { describe, it, expect } from 'vitest';
import { Armor, PLAYER, Weapon } from '@rpg/content';
import { addItem, equipArmor, equipWeapon, ItemKind, makeActor, makeInventory } from '@rpg/rules';
import type { Actor, Inventory } from '@rpg/rules';
import { drawCharacter, drawDeath, drawInventory } from '@rpg/ui';
import { assertSnapshot } from './snapshot.js';
import { referenceScreen } from './scene.js';

function bohater(): { a: Actor; inv: Inventory } {
  const a = makeActor(PLAYER.hp, PLAYER.stamina, PLAYER.attrs, PLAYER.skills);
  equipWeapon(a, Weapon.Shortsword);
  equipArmor(a, Armor.Leather);
  a.hp = 31;
  a.stamina = 62;
  a.weaponWear = 12;
  const inv = makeInventory();
  addItem(inv, ItemKind.Weapon, Weapon.Dagger, a);
  addItem(inv, ItemKind.Weapon, Weapon.Club, a);
  addItem(inv, ItemKind.Armor, Armor.Mail, a);
  return { a, inv };
}

describe('panele w buforze znaków', () => {
  it('inventory-panel: plecak z kursorem na drugiej pozycji', () => {
    const s = referenceScreen();
    const { a, inv } = bohater();
    drawInventory(s, a, inv, 1);
    assertSnapshot('inventory-panel', s.toText());
  });

  it('character-sheet: atrybuty, umiejętności i zasoby', () => {
    const s = referenceScreen();
    const { a } = bohater();
    drawCharacter(s, a);
    assertSnapshot('character-sheet', s.toText());
  });

  it('death-screen: przyczyna, czas gry i wyjście', () => {
    const s = referenceScreen();
    drawDeath(s, 'zabity przez goblina', 3.4, true);
    assertSnapshot('death-screen', s.toText());
  });

  it('panel zamalowuje świat pod sobą', () => {
    // Panel bez tła przepuszczałby teren między literami i byłby nieczytelny.
    const s = referenceScreen();
    for (let i = 0; i < s.chars.length; i++) s.chars[i] = 35; // '#'
    const { a, inv } = bohater();
    drawInventory(s, a, inv, 0);
    const linie = s.toText().split('\n');
    const gora = linie.findIndex((l) => l.includes('EKWIPUNEK'));
    expect(gora).toBeGreaterThanOrEqual(0);
    // wnętrze panelu tuż pod ramką: między pionowymi kreskami ma być pusto
    const wiersz = linie[gora + 1] ?? '';
    const lewa = wiersz.indexOf('║');
    const prawa = wiersz.lastIndexOf('║');
    expect(lewa).toBeGreaterThanOrEqual(0);
    expect(prawa).toBeGreaterThan(lewa);
    expect(wiersz.slice(lewa + 1, prawa).trim()).toBe('');
  });

  it('kursor pokazuje wybraną pozycję i tylko ją', () => {
    const s = referenceScreen();
    const { a, inv } = bohater();
    drawInventory(s, a, inv, 2);
    const kursory = (s.toText().match(/>/g) ?? []).length;
    expect(kursory).toBe(1);
  });

  it('przeciążenie widać na pasku, nie tylko w liczbie', () => {
    const s = referenceScreen();
    const { a, inv } = bohater();
    for (let i = 0; i < 12; i++) addItem(inv, ItemKind.Armor, Armor.Mail, a);
    drawInventory(s, a, inv, 0);
    const tekst = s.toText();
    // pasek pełny: same znaki wypełnienia, żadnej kropki niedopełnienia w jego zakresie
    const wiersz = tekst.split('\n').find((l) => l.includes('obciążenie')) ?? '';
    expect(wiersz).toContain('####');
    expect(wiersz.slice(wiersz.indexOf('####'))).not.toContain('.');
  });
});
