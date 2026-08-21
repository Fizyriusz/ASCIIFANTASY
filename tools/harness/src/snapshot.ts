import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '..', 'golden');

/**
 * Porównuje render z plikiem złotym. Render jest tekstem, więc regresja graficzna
 * jest diffem tekstowym — to przewaga, której nie ma żaden silnik 3D.
 *
 * SNAP_UPDATE=1 nadpisuje wzorce. Robimy to wyłącznie świadomie, po obejrzeniu diffu.
 */
export function assertSnapshot(name: string, actual: string): void {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  const path = join(GOLDEN_DIR, `${name}.txt`);

  if (process.env['SNAP_UPDATE'] === '1' || !existsSync(path)) {
    writeFileSync(path, actual, 'utf8');
    return;
  }

  const expected = readFileSync(path, 'utf8');
  if (expected === actual) return;

  throw new Error(
    `Snapshot "${name}" różni się od wzorca.\n` +
      `Jeśli zmiana jest zamierzona: obejrzyj diff, opisz ją i uruchom pnpm snap:update.\n\n` +
      diff(expected, actual),
  );
}

function diff(expected: string, actual: string): string {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const out: string[] = [];
  const n = Math.max(e.length, a.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 12; i++) {
    if (e[i] !== a[i]) {
      out.push(`wiersz ${i}:`);
      out.push(`  oczekiwano: ${e[i] ?? '<brak>'}`);
      out.push(`  otrzymano:  ${a[i] ?? '<brak>'}`);
      shown++;
    }
  }
  if (shown === 0) out.push('(różnica poza pierwszymi wierszami — sprawdź białe znaki)');
  return out.join('\n');
}
