import { MeResponseSchema } from './me';

const preferences = {
  voiceSlug: 'anna',
  styles: ['facts'],
  interestSlugs: ['history'],
  customInterests: ['сон на облаке'],
};

describe('MeResponseSchema', () => {
  it('accepts the not-onboarded shape', () => {
    expect(
      MeResponseSchema.safeParse({ onboardingCompleted: false, preferences: null }).success,
    ).toBe(true);
  });

  it('accepts the onboarded shape', () => {
    expect(MeResponseSchema.safeParse({ onboardingCompleted: true, preferences }).success).toBe(
      true,
    );
  });

  it('rejects onboardingCompleted false with preferences', () => {
    expect(MeResponseSchema.safeParse({ onboardingCompleted: false, preferences }).success).toBe(
      false,
    );
  });

  it('rejects onboardingCompleted true with null preferences', () => {
    expect(
      MeResponseSchema.safeParse({ onboardingCompleted: true, preferences: null }).success,
    ).toBe(false);
  });

  it('rejects an email or user id in the response', () => {
    expect(
      MeResponseSchema.safeParse({
        onboardingCompleted: false,
        preferences: null,
        email: 'a@b.c',
      }).success,
    ).toBe(false);
    expect(
      MeResponseSchema.safeParse({
        onboardingCompleted: false,
        preferences: null,
        userId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing discriminator', () => {
    expect(MeResponseSchema.safeParse({ preferences: null }).success).toBe(false);
  });

  it('rejects preferences without customInterests', () => {
    const { customInterests: _omitted, ...rest } = preferences;
    expect(
      MeResponseSchema.safeParse({ onboardingCompleted: true, preferences: rest }).success,
    ).toBe(false);
  });

  it('accepts custom-only preferences', () => {
    expect(
      MeResponseSchema.safeParse({
        onboardingCompleted: true,
        preferences: { ...preferences, interestSlugs: [] },
      }).success,
    ).toBe(true);
  });
});
