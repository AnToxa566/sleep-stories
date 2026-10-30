import { PLACEHOLDER_INTEREST_SLUGS, PLACEHOLDER_VOICE_SLUGS } from './placeholder-catalog';
import { SlugSchema } from './slug';

describe('placeholder catalog', () => {
  it('contains only valid, unique slugs', () => {
    for (const list of [PLACEHOLDER_VOICE_SLUGS, PLACEHOLDER_INTEREST_SLUGS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const slug of list) {
        expect(SlugSchema.safeParse(slug).success).toBe(true);
      }
    }
  });
});
