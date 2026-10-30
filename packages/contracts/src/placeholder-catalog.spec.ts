import { PLACEHOLDER_VOICE_SLUGS } from './placeholder-catalog';
import { SlugSchema } from './slug';

describe('placeholder catalog', () => {
  it('contains only valid, unique voice slugs', () => {
    expect(new Set(PLACEHOLDER_VOICE_SLUGS).size).toBe(PLACEHOLDER_VOICE_SLUGS.length);
    for (const slug of PLACEHOLDER_VOICE_SLUGS) {
      expect(SlugSchema.safeParse(slug).success).toBe(true);
    }
  });
});
