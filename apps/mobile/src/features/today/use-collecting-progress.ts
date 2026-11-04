import type { Animated } from 'react-native';
import { COLLECT_FAKE_MS } from './progress';
import { useFakeProgress } from './use-fake-progress';

// The fake fill of the «Собираем…» pill while the server says `collecting: true`: about
// 30 seconds to the cap (progress.ts). Not persisted: after an app restart it starts again
// from the first answer.
export function useCollectingProgress(collecting: boolean): Animated.Value {
  return useFakeProgress(collecting, COLLECT_FAKE_MS);
}
