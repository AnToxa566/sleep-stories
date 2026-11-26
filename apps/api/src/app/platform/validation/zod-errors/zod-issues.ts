// Turns a Zod error into a message that is safe to return to the client and to
// log: issue paths and Zod issue codes only. It never includes `message`,
// `input`, `received`, `keys` or any other field that can carry a submitted
// value (SECURITY.md, logging rule). Paths are schema-defined names or array
// indexes: the contracts schemas have no records, so a path never contains a
// key the client invented.
const MAX_ISSUES = 10;

interface IssueLike {
  path: readonly PropertyKey[];
  code: string;
}

function isIssueLike(value: unknown): value is IssueLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { path?: unknown; code?: unknown };
  return Array.isArray(candidate.path) && typeof candidate.code === 'string';
}

export function describeZodIssues(error: unknown): string {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) {
    return 'Request validation failed';
  }
  const parts = issues
    .filter(isIssueLike)
    .slice(0, MAX_ISSUES)
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return `${path === '' ? '(root)' : path}: ${issue.code}`;
    });
  return parts.length === 0 ? 'Request validation failed' : `Request validation failed: ${parts.join('; ')}`;
}
