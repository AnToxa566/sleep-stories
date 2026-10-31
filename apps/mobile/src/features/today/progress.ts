import type { QueueItem } from '@sleep-stories/contracts';

// A client-side estimate for the progress fill on «Создаётся…». The server reports no
// progress, so this only shows that time passes; it is never persisted and never reaches
// 100%: the fill stops short of full until the queue actually turns ready.
export const PROGRESS_CAP = 0.92;
// Time constant of the ease-out curve: about 2 minutes (the copy says «~2 мин») brings
// the fill to roughly 0.86 of its cap.
const TAU_MS = 45_000;

// 0..PROGRESS_CAP, rising quickly then slowing, from the first moment the screen saw a
// creating item. Bad input gives 0.
export function estimateProgress(creatingSince: number, now: number): number {
  const elapsed = now - creatingSince;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return PROGRESS_CAP * (1 - Math.exp(-elapsed / TAU_MS));
}

// Tracks when the screen first saw a creating item: keeps the earlier time while creation
// continues, starts at `now` when it first appears, resets to null when nothing is creating.
export function nextCreatingSince(
  previous: number | null,
  items: readonly QueueItem[],
  now: number,
): number | null {
  if (!items.some((item) => item.state === 'creating')) return null;
  return previous ?? now;
}

// The same for the empty queue: when the screen first saw `collecting: true` from the server.
// Keeps the earlier time while collecting continues, resets to null when it stops.
export function nextCollectingSince(
  previous: number | null,
  collecting: boolean,
  now: number,
): number | null {
  if (!collecting) return null;
  return previous ?? now;
}
