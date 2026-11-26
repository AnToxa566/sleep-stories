import {
  SuggestTopicsRequestSchema,
  SuggestionStatusResponseSchema,
} from './suggest-topics';

describe('SuggestTopicsRequestSchema', () => {
  const ok = { styles: ['facts'], interestSlugs: ['space'], customInterests: [] };

  it('accepts one style and one catalogue or typed interest', () => {
    expect(SuggestTopicsRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      SuggestTopicsRequestSchema.safeParse({ ...ok, interestSlugs: [], customInterests: ['кошки'] })
        .success,
    ).toBe(true);
  });

  it('normalises typed interests like onboarding does', () => {
    const parsed = SuggestTopicsRequestSchema.parse({ ...ok, customInterests: ['  Кошки '] });
    expect(parsed.customInterests).toEqual(['кошки']);
  });

  it.each([
    { ...ok, styles: [] },
    { ...ok, interestSlugs: [], customInterests: [] },
    { ...ok, styles: ['facts', 'facts'] },
    { ...ok, userId: '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b' },
    { styles: ['facts'], interestSlugs: ['space'] },
  ])('rejects %j', (body) => {
    expect(SuggestTopicsRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('SuggestionStatusResponseSchema', () => {
  const id = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';

  it('accepts no suggestion yet, a running one and a used-up cap', () => {
    expect(
      SuggestionStatusResponseSchema.safeParse({
        latest: null,
        suggestions: { left: 5, limit: 5, nextAt: null },
      }).success,
    ).toBe(true);
    expect(
      SuggestionStatusResponseSchema.safeParse({
        latest: { id, state: 'running' },
        suggestions: { left: 0, limit: 5, nextAt: '2026-11-23T02:14:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown state and a non-ISO time', () => {
    expect(
      SuggestionStatusResponseSchema.safeParse({
        latest: { id, state: 'pending' },
        suggestions: { left: 5, limit: 5, nextAt: null },
      }).success,
    ).toBe(false);
    expect(
      SuggestionStatusResponseSchema.safeParse({
        latest: null,
        suggestions: { left: 0, limit: 5, nextAt: 'tomorrow' },
      }).success,
    ).toBe(false);
  });
});
