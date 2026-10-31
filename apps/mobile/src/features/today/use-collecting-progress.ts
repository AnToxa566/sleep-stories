import { useEffect, useState } from 'react';
import { estimateProgress, nextCollectingSince } from './progress';

// How often the fill is recomputed while the queue is being collected.
const TICK_MS = 1000;

// The estimated fill (0..PROGRESS_CAP) of the «Собираем…» pill, counted from the moment this
// screen first saw `collecting: true` from the server; 0 otherwise. Not persisted: after an
// app restart it starts again from the first answer. The tick runs only while collecting and
// never calls the API; JavaScript timers pause in the background on Android and the estimate
// catches up on return.
export function useCollectingProgress(collecting: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSince((previous) => nextCollectingSince(previous, collecting, Date.now()));
  }, [collecting]);

  const active = since !== null;
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  return since === null ? 0 : estimateProgress(since, now);
}
