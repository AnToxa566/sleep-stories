import type { QueueItem } from '@sleep-stories/contracts';
import type { Animated } from 'react-native';
import { GENERATION_FAKE_MS } from './progress';
import { useFakeProgress } from './use-fake-progress';

// The fake fill of the main button while an item is `creating`: about three minutes to the
// cap (progress.ts), the same value for every creating item.
export function useCreatingProgress(items: readonly QueueItem[]): Animated.Value {
  const creating = items.some((item) => item.state === 'creating');
  return useFakeProgress(creating, GENERATION_FAKE_MS);
}
