import { SlugSchema } from './slug';

describe('SlugSchema', () => {
  it.each(['anna', 'deep-space', 'a1', 'a-b-c'])('accepts %s', (slug) => {
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['Anna', 'deep_space', '', '-a', 'a-', 'a--b', 'a b', ' anna', 'anna ', 'anna\n', 'ru-слово', 'a'.repeat(65)])(
    'rejects %j',
    (slug) => {
      expect(SlugSchema.safeParse(slug).success).toBe(false);
    },
  );
});
