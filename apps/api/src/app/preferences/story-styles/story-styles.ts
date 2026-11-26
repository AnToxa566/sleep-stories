import { StoryStyleSchema } from '@sleep-stories/contracts';
import type { StoryStyle } from '@sleep-stories/contracts';

// Styles in the canonical enum order (facts, fairy_tale, history), so the same
// set always reads back the same way whatever order the client sent it in.
export function inCanonicalOrder(styles: readonly StoryStyle[]): StoryStyle[] {
  return StoryStyleSchema.options.filter((style) => styles.includes(style));
}
