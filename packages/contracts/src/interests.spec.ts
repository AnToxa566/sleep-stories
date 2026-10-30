import {
  CustomInterestSchema,
  CustomInterestsSchema,
  InterestSchema,
  InterestsResponseSchema,
} from './interests';

describe('InterestSchema', () => {
  it('accepts a slug and a Russian title', () => {
    expect(InterestSchema.safeParse({ slug: 'space', title: 'Космос' }).success).toBe(true);
  });

  it('rejects an extra key', () => {
    expect(
      InterestSchema.safeParse({ slug: 'space', title: 'Космос', userId: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a bad slug and an empty title', () => {
    expect(InterestSchema.safeParse({ slug: 'Space', title: 'Космос' }).success).toBe(false);
    expect(InterestSchema.safeParse({ slug: 'space', title: '' }).success).toBe(false);
  });
});

describe('InterestsResponseSchema', () => {
  it('accepts a list, including an empty one', () => {
    expect(
      InterestsResponseSchema.safeParse({ interests: [{ slug: 'space', title: 'Космос' }] })
        .success,
    ).toBe(true);
    expect(InterestsResponseSchema.safeParse({ interests: [] }).success).toBe(true);
  });

  it('rejects an extra key and a missing list', () => {
    expect(InterestsResponseSchema.safeParse({ interests: [], extra: 1 }).success).toBe(false);
    expect(InterestsResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('CustomInterestSchema', () => {
  it('trims and lowercases, including Russian text', () => {
    const result = CustomInterestSchema.safeParse('  Сон на ОБЛАКЕ  ');
    expect(result.success && result.data).toBe('сон на облаке');
  });

  it('accepts other scripts and emoji', () => {
    expect(CustomInterestSchema.safeParse('jazz 音楽 🌙').success).toBe(true);
  });

  it('accepts exactly 60 characters and rejects 61', () => {
    expect(CustomInterestSchema.safeParse('я'.repeat(60)).success).toBe(true);
    expect(CustomInterestSchema.safeParse('я'.repeat(61)).success).toBe(false);
  });

  it('measures length after trimming', () => {
    expect(CustomInterestSchema.safeParse(` ${'я'.repeat(60)} `).success).toBe(true);
  });

  it.each(['', '   ', '\t', '\n'])('rejects blank %j', (value) => {
    expect(CustomInterestSchema.safeParse(value).success).toBe(false);
  });

  it.each(['one\ntwo', 'one\r\ntwo', 'one\ttwo', 'one\u0000two', 'one\u001btwo', 'one two'])(
    'rejects control characters in %j',
    (value) => {
      expect(CustomInterestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects a non-string', () => {
    expect(CustomInterestSchema.safeParse(5).success).toBe(false);
    expect(CustomInterestSchema.safeParse(null).success).toBe(false);
  });
});

describe('CustomInterestsSchema', () => {
  it('accepts an empty list and 20 entries', () => {
    expect(CustomInterestsSchema.safeParse([]).success).toBe(true);
    const twenty = Array.from({ length: 20 }, (_, i) => `тема ${i}`);
    expect(CustomInterestsSchema.safeParse(twenty).success).toBe(true);
  });

  it('rejects 21 entries', () => {
    const many = Array.from({ length: 21 }, (_, i) => `тема ${i}`);
    expect(CustomInterestsSchema.safeParse(many).success).toBe(false);
  });

  it('rejects case-insensitive duplicates', () => {
    expect(CustomInterestsSchema.safeParse(['Маяки', 'маяки']).success).toBe(false);
    expect(CustomInterestsSchema.safeParse(['маяки', ' МАЯКИ ']).success).toBe(false);
  });

  it('treats composed and decomposed forms of the same text as duplicates', () => {
    const composed = 'чай'; // the last letter is U+0439
    const decomposed = 'чаи\u0306'; // U+0438 followed by the combining breve U+0306
    expect(composed).not.toBe(decomposed);
    expect(CustomInterestsSchema.safeParse([composed, decomposed]).success).toBe(false);
    const parsed = CustomInterestSchema.safeParse(decomposed);
    expect(parsed.success && parsed.data).toBe(composed);
  });

  it('accepts distinct entries', () => {
    expect(CustomInterestsSchema.safeParse(['маяки', 'море']).success).toBe(true);
  });
});
