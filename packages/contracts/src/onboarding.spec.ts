import { CompleteOnboardingRequestSchema } from './onboarding';
import { SlugSchema } from './slug';
import { StoryStyleSchema } from './story-style';

const valid = {
  voiceSlug: 'anna',
  styles: ['facts', 'fairy_tale'],
  interestSlugs: ['history', 'space'],
};

describe('CompleteOnboardingRequestSchema', () => {
  it('accepts a valid body', () => {
    expect(CompleteOnboardingRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an extra userId key', () => {
    const result = CompleteOnboardingRequestSchema.safeParse({
      ...valid,
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.success).toBe(false);
  });

  it('rejects any other extra key', () => {
    expect(CompleteOnboardingRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(
      false,
    );
  });

  it('rejects empty styles', () => {
    expect(CompleteOnboardingRequestSchema.safeParse({ ...valid, styles: [] }).success).toBe(false);
  });

  it('rejects an unknown style', () => {
    expect(CompleteOnboardingRequestSchema.safeParse({ ...valid, styles: ['poem'] }).success).toBe(
      false,
    );
  });

  it('rejects duplicate styles', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, styles: ['facts', 'facts'] }).success,
    ).toBe(false);
  });

  it('accepts every style once', () => {
    const all = [...StoryStyleSchema.options];
    expect(CompleteOnboardingRequestSchema.safeParse({ ...valid, styles: all }).success).toBe(true);
  });

  it('reports the max-length check when there are more entries than styles', () => {
    const all = [...StoryStyleSchema.options];
    const result = CompleteOnboardingRequestSchema.safeParse({
      ...valid,
      styles: [...all, all[0]],
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues.some((issue) => issue.code === 'too_big')).toBe(
      true,
    );
  });

  it('rejects a body parsed from JSON with an own "__proto__" key', () => {
    const body: unknown = JSON.parse(
      '{"__proto__": {"admin": true}, "voiceSlug": "anna", "styles": ["facts"], "interestSlugs": ["space"]}',
    );
    expect(Object.keys(body as object)).toContain('__proto__');
    expect(CompleteOnboardingRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a JSON body that smuggles userId next to "__proto__"', () => {
    const body: unknown = JSON.parse(
      '{"__proto__": {}, "userId": "x", "voiceSlug": "anna", "styles": ["facts"], "interestSlugs": ["space"]}',
    );
    expect(CompleteOnboardingRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects empty interestSlugs when there are no custom interests', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, interestSlugs: [] }).success,
    ).toBe(false);
    expect(
      CompleteOnboardingRequestSchema.safeParse({
        ...valid,
        interestSlugs: [],
        customInterests: [],
      }).success,
    ).toBe(false);
  });

  it('defaults customInterests to an empty list', () => {
    const result = CompleteOnboardingRequestSchema.safeParse(valid);
    expect(result.success && result.data.customInterests).toEqual([]);
  });

  it('accepts custom interests only', () => {
    const result = CompleteOnboardingRequestSchema.safeParse({
      ...valid,
      interestSlugs: [],
      customInterests: ['  Сны о МОРЕ '],
    });
    expect(result.success && result.data.customInterests).toEqual(['сны о море']);
  });

  it('accepts slugs plus custom interests', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, customInterests: ['маяки'] }).success,
    ).toBe(true);
  });

  it('rejects 21 custom interests', () => {
    const many = Array.from({ length: 21 }, (_, i) => `тема ${i}`);
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, customInterests: many }).success,
    ).toBe(false);
  });

  it('rejects case-insensitive duplicate custom interests', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, customInterests: ['Маяки', 'маяки '] })
        .success,
    ).toBe(false);
  });

  it('rejects a blank custom interest', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, customInterests: ['   '] }).success,
    ).toBe(false);
  });

  it('rejects duplicate interest slugs', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, interestSlugs: ['space', 'space'] })
        .success,
    ).toBe(false);
  });

  it('rejects more than 50 interest slugs', () => {
    const many = Array.from({ length: 51 }, (_, i) => `interest-${i}`);
    expect(
      CompleteOnboardingRequestSchema.safeParse({ ...valid, interestSlugs: many }).success,
    ).toBe(false);
  });

  it('rejects an uppercase voice slug', () => {
    expect(CompleteOnboardingRequestSchema.safeParse({ ...valid, voiceSlug: 'Anna' }).success).toBe(
      false,
    );
  });

  it('rejects a missing field', () => {
    expect(
      CompleteOnboardingRequestSchema.safeParse({ styles: valid.styles, interestSlugs: valid.interestSlugs })
        .success,
    ).toBe(false);
  });
});

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
