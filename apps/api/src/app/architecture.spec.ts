import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Two rules of AGENTS.md that used to be kept by agreement, now kept by a check:
//
// 1. Architecture rule 10: a `write_story` or `render_audio` job is created only by the
//    person's explicit start (`generation-start-plan.ts`, used by `GenerationStartService`)
//    or by the chain write -> render (`write-story.handler.ts`). The check looks for a job
//    payload written with `kind: 'write_story'` / `kind: 'render_audio'` anywhere else.
// 2. The lock on a person's `users` row is taken through `lockUserRow` only, so the query
//    text and the order of locks have one owner.
//
// This is a text scan, not a proof: it catches the usual way to break the rules (copying the
// payload or the lock query into a new file) and not an exotic one (building the string in
// pieces). Cost: a false alarm in a file that merely contains the text, which is then moved
// or renamed on purpose. Spec files, test support and generated code are skipped.

const SRC_ROOT = join(__dirname, '..');

const STORY_JOB_KIND = /kind\s*:\s*['"`](?:write_story|render_audio)['"`]/;
// `FOR UPDATE` within a short distance after `FROM users`, across lines.
const USERS_ROW_LOCK = /FROM\s+users\b[\s\S]{0,200}?FOR\s+UPDATE/i;

const STORY_JOB_KIND_ALLOWED = [
  'app/queue/generation-start-plan.ts',
  'app/internal/handlers/write-story.handler.ts',
];
const USERS_ROW_LOCK_ALLOWED = ['app/prisma/lock-user-row.ts'];

function isSkipped(path: string): boolean {
  const parts = path.split('/');
  return (
    path.endsWith('.spec.ts') ||
    path.endsWith('.int-spec.ts') ||
    parts.includes('test-support') ||
    parts.includes('generated')
  );
}

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSources(full));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

function sourcesMatching(pattern: RegExp, allowed: readonly string[]): string[] {
  return listSources(SRC_ROOT)
    .map((full) => relative(SRC_ROOT, full).split(sep).join('/'))
    .filter((path) => !isSkipped(path) && !allowed.includes(path))
    .filter((path) => pattern.test(readFileSync(join(SRC_ROOT, path), 'utf8')))
    .sort();
}

describe('architecture rules kept by a scan of apps/api/src', () => {
  it('finds source files to scan (the scan is not empty)', () => {
    const scanned = listSources(SRC_ROOT).filter((full) => !isSkipped(relative(SRC_ROOT, full)));
    expect(scanned.length).toBeGreaterThan(20);
    for (const path of [...STORY_JOB_KIND_ALLOWED, ...USERS_ROW_LOCK_ALLOWED]) {
      expect(readFileSync(join(SRC_ROOT, path), 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('creates write_story and render_audio payloads only in the explicit start and the chain', () => {
    expect(sourcesMatching(STORY_JOB_KIND, STORY_JOB_KIND_ALLOWED)).toEqual([]);
  });

  it('allowed files really contain the payloads (so the allow-list is not stale)', () => {
    for (const path of STORY_JOB_KIND_ALLOWED) {
      expect(STORY_JOB_KIND.test(readFileSync(join(SRC_ROOT, path), 'utf8'))).toBe(true);
    }
  });

  it('locks the users row only through lockUserRow', () => {
    expect(sourcesMatching(USERS_ROW_LOCK, USERS_ROW_LOCK_ALLOWED)).toEqual([]);
    expect(USERS_ROW_LOCK.test(readFileSync(join(SRC_ROOT, USERS_ROW_LOCK_ALLOWED[0]), 'utf8'))).toBe(true);
  });
});

describe('the patterns of the scan', () => {
  it('match every spelling of a story job payload', () => {
    for (const sample of [
      "{ kind: 'write_story', topicId }",
      '{ kind: "render_audio", storyId }',
      '{ kind: `write_story` }',
      "{ kind:'render_audio' }",
      "{\n  kind :  'write_story',\n}",
    ]) {
      expect(STORY_JOB_KIND.test(sample)).toBe(true);
    }
  });

  it('do not match other uses of the names', () => {
    for (const sample of [
      "kind: 'suggest_topics'",
      "const kind = 'write_story';",
      "dedupeKey: `write_story:${topicId}`",
      "JobKindSchema.parse('render_audio')",
      "{ kind: kindOf(job) }",
    ]) {
      expect(STORY_JOB_KIND.test(sample)).toBe(false);
    }
  });

  it('match a lock on the users row however it is laid out', () => {
    for (const sample of [
      'SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE',
      'select 1 from users where id = $1 for update',
      'SELECT 1\n  FROM users\n  WHERE id = ${userId}::uuid\n  FOR   UPDATE NOWAIT',
    ]) {
      expect(USERS_ROW_LOCK.test(sample)).toBe(true);
    }
  });

  it('do not match locks on other tables or reads without a lock', () => {
    for (const sample of [
      'SELECT id FROM users WHERE id = ${userId}::uuid',
      'SELECT id FROM queue_items WHERE user_id = ${userId}::uuid FOR UPDATE',
      'SELECT 1 FROM user_topics WHERE user_id = ${userId}::uuid FOR UPDATE',
    ]) {
      expect(USERS_ROW_LOCK.test(sample)).toBe(false);
    }
  });
});
