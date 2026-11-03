import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// AGENTS.md architecture rule 10: nothing that costs money starts on its own. In the app
// that means the two generate mutations (and the paths they call) exist only in the queue
// queries module, and are used only in the screen and its components, where a tap calls
// them. This is a text scan: it catches the usual slip (calling a generate path from a new
// helper, a hook or an effect) and not an exotic one. A false alarm in a file that merely
// mentions the names is cured by moving the text, not by widening the allow-list.

const SRC_ROOT = join(__dirname, '..', '..');

const GENERATE =
  /useGenerate(?:All|One)\b|\bgenerate(?:All|One)\b|\/queue\/generate|\/generate\b/;

const COLLECT = /useCollectQueue\b|\/queue\/collect/;

const DEFINITION = 'features/today/queue-queries.ts';

// POST /queue/continue (the touch during the waves after the last story) may create at most a
// topic suggestion on the server. Only the player feature may name it.
const CONTINUE = /useContinueQueue\b|\/queue\/continue/;
const PLAYER_QUERIES = 'features/player/player-queries.ts';

// A user action may call the mutations: the screen and the components under features/today.
function isScreenOrComponent(path: string): boolean {
  return path === 'app/(app)/(tabs)/home.tsx' || (path.startsWith('features/today/') && path.endsWith('.tsx'));
}

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const sources = listSources(SRC_ROOT).map((full) => ({
  path: relative(SRC_ROOT, full).split(sep).join('/'),
  text: readFileSync(full, 'utf8'),
}));

describe('rule 10 in the mobile app: generate is a tap, never automatic', () => {
  it('scans the source tree (the scan is not empty)', () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((source) => source.path === DEFINITION)).toBe(true);
  });

  it('names the generate mutations and paths only in the queries module, the screen and its components', () => {
    const offenders = sources
      .filter((source) => source.path !== DEFINITION && !isScreenOrComponent(source.path))
      .filter((source) => GENERATE.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });

  it('defines both mutations and both paths in the queries module (the allow-list is not stale)', () => {
    const text = sources.find((source) => source.path === DEFINITION)?.text ?? '';
    expect(text).toMatch(/export function useGenerateAll\b/);
    expect(text).toMatch(/export function useGenerateOne\b/);
    expect(text).toContain("path: '/queue/generate'");
    expect(text).toMatch(/\/generate`/);
  });

  it('never calls a mutation, runs an effect or fires a callback chain inside the queries module', () => {
    const code = (sources.find((source) => source.path === DEFINITION)?.text ?? '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\.mutate(?:Async)?\(/);
    expect(code).not.toMatch(/\buseEffect\b|\buseLayoutEffect\b/);
  });

  it('keeps «Собрать подборку» a tap too, and a route that is not a story job route', () => {
    const offenders = sources
      .filter((source) => source.path !== DEFINITION && !isScreenOrComponent(source.path))
      .filter((source) => COLLECT.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);

    const text = sources.find((source) => source.path === DEFINITION)?.text ?? '';
    const start = text.indexOf('export function useCollectQueue');
    expect(start).toBeGreaterThan(-1);
    expect(text).toContain("path: '/queue/collect'");
    // From the hook to the end of the module: no story job route may be named there.
    expect(text.slice(start)).not.toMatch(GENERATE);
  });

  it('names the continue mutation and path only in the player feature', () => {
    const offenders = sources
      .filter((source) => !source.path.startsWith('features/player/'))
      .filter((source) => CONTINUE.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);

    const text = sources.find((source) => source.path === PLAYER_QUERIES)?.text ?? '';
    expect(text).toMatch(/export function useContinueQueue\b/);
    expect(text).toContain("path: '/queue/continue'");
  });

  it('keeps the player free of any generate or collect mutation or path', () => {
    const own = sources.filter(
      (source) =>
        source.path.startsWith('features/player/') || source.path === 'app/(app)/player.tsx',
    );
    expect(own.length).toBeGreaterThan(0);
    const offenders = own
      .filter((source) => GENERATE.test(source.text) || COLLECT.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });

  it('keeps «Темы» and «Замена» free of any generate or collect mutation', () => {
    const own = sources.filter(
      (source) =>
        source.path.startsWith('features/topics/') ||
        source.path === 'app/(app)/(tabs)/topics.tsx' ||
        source.path === 'app/(app)/replace.tsx',
    );
    expect(own.length).toBeGreaterThan(0);
    const offenders = own
      .filter((source) => GENERATE.test(source.text) || COLLECT.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });
});
