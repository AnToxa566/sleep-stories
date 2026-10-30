import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The UI is dark-only and never pure white (AGENTS.md rule 8). Tokens are tested in
// theme/tokens.spec.ts; this scan catches a literal white written straight into a screen.
const SRC = join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: '#fff / #ffffff', pattern: /#f{3}(?:f{3})?(?![0-9a-f])/i },
  { name: "'white' / \"white\"", pattern: /['"`]white['"`]/i },
  { name: 'rgb(255,255,255)', pattern: /rgba?\(\s*255\s*,\s*255\s*,\s*255/i },
  { name: 'PlatformColor / processColor white', pattern: /\bcolor\s*:\s*white\b/i },
];

describe('no pure white anywhere under src', () => {
  const files = sourceFiles(SRC);

  it('scans at least the tokens file', () => {
    expect(files.some((f) => f.endsWith('tokens.ts'))).toBe(true);
  });

  it.each(FORBIDDEN)('finds no $name', ({ pattern }) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
