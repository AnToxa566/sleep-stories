import type { QueueItem } from '@sleep-stories/contracts';
import { useEffect, useState } from 'react';
import { estimateProgress, nextCreatingSince } from './progress';

// How often the fill is recomputed while something is being created.
const TICK_MS = 1000;

// The estimated fill (0..PROGRESS_CAP) of the main button while an item is `creating`;
// 0 otherwise. A light state: the time the screen first saw a creating item, and a one second
// tick that runs only while something is being created. It never calls the API, and nothing
// is persisted. JavaScript timers pause while an Android app is in the background, which is
// fine here: the estimate catches up on return.
export function useCreatingProgress(items: readonly QueueItem[]): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSince((previous) => nextCreatingSince(previous, items, Date.now()));
  }, [items]);

  const active = since !== null;
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  return since === null ? 0 : estimateProgress(since, now);
}
