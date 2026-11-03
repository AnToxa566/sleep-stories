import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// People who turned off animations get a still orb and cuts instead of fades.
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return reduced;
}
