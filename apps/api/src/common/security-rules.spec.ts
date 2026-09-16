import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Règles de sécurité vérifiées sur le code source (OWASP : injection SQL). */
describe('règles de sécurité du code', () => {
  const files = sourceFiles(SRC).map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  it('aucune API Prisma « Unsafe » (SQL construit par concaténation)', () => {
    const offenders = files.filter((f) => /\$(query|execute)RawUnsafe/.test(f.content)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('aucun Prisma.raw (fragment SQL non paramétré)', () => {
    const offenders = files.filter((f) => /Prisma\.raw\(/.test(f.content)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('aucun console.log (journalisation non maîtrisée)', () => {
    const offenders = files.filter((f) => /console\.log\(/.test(f.content)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
