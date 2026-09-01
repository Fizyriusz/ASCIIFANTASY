import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Kierunek zależności z `CLAUDE.md` §Układ repo był dotąd **umową społeczną**: nic
 * poza czujnością recenzenta nie broniło przed importem w górę stosu. Ten plik zamienia
 * ją w asercję.
 *
 * Reguła nie jest „core i world nie znają contentu" w sensie dosłownym, bo cały świat
 * jest zbudowany wokół `ContentPack` podawanego z zewnątrz. Właściwa granica przebiega
 * między **typem a wartością**: paczki niżej w stosie mogą znać *kształt* danych
 * (`import type`), ale nie wolno im sięgać po konkretne liczby ani tabele. Świat ma
 * deklarować, czego potrzebuje; content ma to dostarczać.
 */
const ZAKAZY: { paczka: string; zakazane: string[]; opis: string }[] = [
  {
    paczka: 'packages/core',
    zakazane: ['@rpg/world', '@rpg/rules', '@rpg/ui', '@rpg/quest', '@rpg/sim'],
    opis: 'renderer nie ma prawa wiedzieć, że istnieje świat, reguły czy interfejs',
  },
  {
    paczka: 'packages/world',
    zakazane: ['@rpg/rules', '@rpg/ui', '@rpg/quest', '@rpg/sim'],
    opis: 'generacja świata nie zna reguł gry ani interfejsu',
  },
];

/** Wszystkie pliki `.ts` w katalogu, rekurencyjnie. */
function pliki(dir: string): string[] {
  const out: string[] = [];
  for (const wpis of readdirSync(dir)) {
    const p = join(dir, wpis);
    if (statSync(p).isDirectory()) out.push(...pliki(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Wiersze importów w pliku, bez komentarzy — liczy się `import`, nie wzmianka. */
function importy(tresc: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tresc)) !== null) {
    const cel = m[1];
    if (cel !== undefined) out.push(cel);
  }
  return out;
}

/** Czy ten konkretny import jest wyłącznie typem. */
function tylkoTyp(tresc: string, cel: string): boolean {
  const re = new RegExp(`^\\s*import\\s+type\\s[^;]*?from\\s+['"]${cel.replace('/', '\\/')}['"]`, 'm');
  return re.test(tresc);
}

describe('kierunek zależności', () => {
  for (const { paczka, zakazane, opis } of ZAKAZY) {
    it(`${paczka} nie importuje w górę stosu — ${opis}`, () => {
      const zle: string[] = [];
      for (const plik of pliki(join(ROOT, paczka))) {
        const tresc = readFileSync(plik, 'utf8');
        for (const imp of importy(tresc)) {
          if (zakazane.some((z) => imp === z || imp.startsWith(`${z}/`))) {
            zle.push(`${relative(ROOT, plik)} → ${imp}`);
          }
        }
      }
      expect(zle).toEqual([]);
    });
  }

  it('packages/core i packages/world nie importują niczego z apps/', () => {
    // Import z aplikacji do biblioteki jest odwróceniem całego stosu i nie ma
    // wariantu „tylko w teście": test też się kompiluje i też wiąże paczki.
    const zle: string[] = [];
    for (const paczka of ['packages/core', 'packages/world']) {
      for (const plik of pliki(join(ROOT, paczka))) {
        const tresc = readFileSync(plik, 'utf8');
        for (const imp of importy(tresc)) {
          if (imp.includes('apps/')) zle.push(`${relative(ROOT, plik)} → ${imp}`);
        }
      }
    }
    expect(zle).toEqual([]);
  });

  it('kod produkcyjny core i world bierze z contentu typy, nigdy wartości', () => {
    // Wartość z contentu w bibliotece znaczy zaszytą decyzję balansową w silniku —
    // dokładnie to zdarzyło się w M3d (`DUNGEON_SPAWN` w `dungeon.ts`) i dlatego
    // reguły rozmnażania są dziś parametrem funkcji, a nie importem.
    const zle: string[] = [];
    for (const paczka of ['packages/core', 'packages/world']) {
      for (const plik of pliki(join(ROOT, paczka))) {
        // Testy i benchmarki wolno karmić prawdziwą paczką contentu — to są dane
        // wejściowe pomiaru, a nie zależność kodu, który trafia do gry. Fixture ma
        // być **wyłącznie wejściem**, nigdy oczekiwaną wartością: test w rdzeniu
        // porównujący wynik z liczbą z paczki wild przestaje mierzyć silnik, a zaczyna
        // mierzyć zgodność z jedną grą — i wtedy zmiana balansu psuje testy rdzenia.
        if (plik.endsWith('.test.ts') || plik.endsWith('.bench.ts')) continue;
        const tresc = readFileSync(plik, 'utf8');
        for (const imp of importy(tresc)) {
          if (imp === '@rpg/content' || imp.startsWith('@rpg/content/')) {
            if (!tylkoTyp(tresc, imp)) zle.push(`${relative(ROOT, plik)} → ${imp} (wartość)`);
          }
        }
      }
    }
    expect(zle).toEqual([]);
  });

  it('sam strażnik działa: wykrywa import, który łamie regułę', () => {
    // Test testu. Bez tego zmiana wyrażenia regularnego mogłaby po cichu wyłączyć
    // całą asercję, a wszystkie trzy powyższe nadal by przechodziły.
    const przyklad = [
      "import { rnd01 } from '@rpg/world';",
      "import type { MaterialDef } from '@rpg/content';",
      "import { COMBAT } from '@rpg/content';",
      "// import { cos } from '@rpg/ui'; — to jest komentarz",
    ].join('\n');
    const lista = importy(przyklad);
    expect(lista).toContain('@rpg/world');
    expect(lista).toContain('@rpg/content');
    expect(lista).not.toContain('@rpg/ui');
    expect(tylkoTyp("import type { X } from '@rpg/content';", '@rpg/content')).toBe(true);
    expect(tylkoTyp("import { X } from '@rpg/content';", '@rpg/content')).toBe(false);
  });
});
