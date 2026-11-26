// A client-side FAKE progress for the fills on «Создаётся…» and «Собираем…». The server reports
// no progress, so this only shows that time passes. It is never persisted and never reaches
// 100%: it approaches PROGRESS_CAP at the stated duration and then holds, creeping by less
// than PROGRESS_CREEP more, until the real state changes and the fill disappears.
export const PROGRESS_CAP = 0.95;
// After the stated duration the fill still moves a little so it does not look frozen. It never
// adds the whole amount: the total stays under PROGRESS_CAP + PROGRESS_CREEP < 1.
export const PROGRESS_CREEP = 0.02;
// Generating the audio tracks: the copy says «~3 мин».
export const GENERATION_FAKE_MS = 180_000;
// Collecting a selection (a topic suggestion, one cheap model call).
export const COLLECT_FAKE_MS = 30_000;

// 0..PROGRESS_CAP + PROGRESS_CREEP (exclusive), from `since` to `now`: quick at the start,
// slowing as the stated `durationMs` nears (quadratic ease-out), about PROGRESS_CAP at
// `durationMs`, then a slow creep. Bad input gives 0.
export function estimateProgress(since: number, now: number, durationMs: number): number {
  const elapsed = now - since;
  if (!Number.isFinite(elapsed) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (elapsed <= 0) return 0;
  const t = elapsed / durationMs;
  if (t < 1) return PROGRESS_CAP * (1 - (1 - t) * (1 - t));
  return PROGRESS_CAP + PROGRESS_CREEP * (1 - Math.exp(-(t - 1)));
}

// How long "nothing is active" has to last before the fill starts over from zero. A refetch or
// a poll can show a moment with no creating item (or `collecting: false`); this keeps the fill
// from restarting then. Longer than that, the work is over and the next one starts from zero.
export const SINCE_GRACE_MS = 4000;

export interface SinceTrack {
  // When the work was first seen; the fill is counted from here.
  readonly since: number;
  // The last moment it was seen active.
  readonly lastActive: number;
}

// Advances the track one observation. Active: the earlier start is kept whatever the gap
// (a return from the background must not reset a running fill), a first sighting starts at
// `now`. Not active: the track survives for `graceMs` after it was last active, then ends.
export function nextSinceTrack(
  previous: SinceTrack | null,
  active: boolean,
  now: number,
  graceMs: number = SINCE_GRACE_MS,
): SinceTrack | null {
  if (active) {
    return { since: previous?.since ?? now, lastActive: now };
  }
  if (previous === null) return null;
  return now - previous.lastActive > graceMs ? null : previous;
}
