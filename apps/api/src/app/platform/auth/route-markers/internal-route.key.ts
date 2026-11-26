// Metadata key set by @InternalRoute(). It lives in auth/ so that the global
// JwtAuthGuard can read it without importing from internal/.
export const IS_INTERNAL_KEY = 'isInternalRoute';

// A well-known symbol that InternalAuthGuard carries as a static property. The global
// JwtAuthGuard steps aside for a route only when this marker is found among the route's
// guards (on the handler or the class) as well as IS_INTERNAL_KEY, so the mark alone never
// opens a route. Symbol.for, so auth/ needs no import from internal/.
export const INTERNAL_GUARD_MARKER: unique symbol = Symbol.for('sleep-stories.internalAuthGuard');

// True when one entry of a guards list (a class, or an instance of one) is the internal
// guard.
export function isInternalGuard(entry: unknown): boolean {
  const guardClass = typeof entry === 'function' ? entry : (entry as { constructor?: unknown } | null)?.constructor;
  return (
    typeof guardClass === 'function' &&
    (guardClass as unknown as Record<symbol, unknown>)[INTERNAL_GUARD_MARKER] === true
  );
}
