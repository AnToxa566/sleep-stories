import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { estimateProgress, nextSinceTrack, type SinceTrack } from './progress';

// How often the fill is recomputed while it is running: four times a second moves a 300 px
// fill by well under a pixel per step over three minutes, which reads as smooth.
const TICK_MS = 250;

// The fake fill (0..1, see progress.ts) of a «working…» button, as an Animated.Value so a
// tick moves the fill without re-rendering the screen. `active` says the work is going on;
// the fill is counted from the first moment it was seen active and survives short gaps
// (SINCE_GRACE_MS). The tick runs only while there is something to show; JavaScript timers
// pause while an Android app is in the background, which is fine: the value is computed from
// the clock, so it catches up on return. Nothing here calls the API or persists anything.
export function useFakeProgress(active: boolean, durationMs: number): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const activeRef = useRef(active);
  const trackRef = useRef<SinceTrack | null>(null);
  const [running, setRunning] = useState(active);

  useEffect(() => {
    activeRef.current = active;
    if (active) setRunning(true);
  }, [active]);

  useEffect(() => {
    if (!running) return undefined;
    const step = () => {
      const now = Date.now();
      trackRef.current = nextSinceTrack(trackRef.current, activeRef.current, now);
      const track = trackRef.current;
      if (track === null) {
        value.setValue(0);
        setRunning(false);
        return;
      }
      value.setValue(estimateProgress(track.since, now, durationMs));
    };
    step();
    const timer = setInterval(step, TICK_MS);
    return () => clearInterval(timer);
  }, [running, durationMs, value]);

  return value;
}
