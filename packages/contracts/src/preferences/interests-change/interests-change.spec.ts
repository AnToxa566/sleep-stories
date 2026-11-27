import { ChangeInterestsRequestSchema } from './interests-change';

describe('ChangeInterestsRequestSchema', () => {
  it('accepts both lists and normalises the typed titles', () => {
    expect(
      ChangeInterestsRequestSchema.parse({ interestSlugs: ['space'], customInterests: ['  Старые Поезда '] }),
    ).toEqual({ interestSlugs: ['space'], customInterests: ['старые поезда'] });
  });

  it.each([
    ['catalogue interests alone', { interestSlugs: ['space'], customInterests: [] }],
    ['typed interests alone', { interestSlugs: [], customInterests: ['кофе'] }],
  ])('accepts %s', (_label, body) => {
    expect(ChangeInterestsRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects an extra userId key', () => {
    const body = { interestSlugs: ['space'], customInterests: [], userId: '11111111-1111-4111-8111-111111111111' };
    expect(ChangeInterestsRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['no customInterests (no default, so nothing is wiped by omission)', { interestSlugs: ['space'] }],
    ['no interestSlugs', { customInterests: ['кофе'] }],
    ['an empty body', {}],
    ['no interest at all', { interestSlugs: [], customInterests: [] }],
    ['a repeated slug', { interestSlugs: ['space', 'space'], customInterests: [] }],
    ['typed titles equal after normalisation', { interestSlugs: [], customInterests: ['Кофе', ' кофе'] }],
    ['a blank typed title', { interestSlugs: ['space'], customInterests: ['  '] }],
    ['a wrong type', { interestSlugs: 'space', customInterests: [] }],
  ])('rejects %s', (_label, body) => {
    expect(ChangeInterestsRequestSchema.safeParse(body).success).toBe(false);
  });
});
