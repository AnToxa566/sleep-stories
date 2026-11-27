import { ChangeVoiceRequestSchema } from './voice-change';

describe('ChangeVoiceRequestSchema', () => {
  it('accepts a valid body', () => {
    expect(ChangeVoiceRequestSchema.parse({ voiceSlug: 'anna' })).toEqual({ voiceSlug: 'anna' });
  });

  it('rejects an extra userId key', () => {
    const body = { voiceSlug: 'anna', userId: '11111111-1111-4111-8111-111111111111' };
    expect(ChangeVoiceRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['no voice', {}],
    ['an empty slug', { voiceSlug: '' }],
    ['an uppercase slug', { voiceSlug: 'Anna' }],
    ['a slug with a space', { voiceSlug: 'an na' }],
    ['a wrong type', { voiceSlug: 42 }],
  ])('rejects %s', (_label, body) => {
    expect(ChangeVoiceRequestSchema.safeParse(body).success).toBe(false);
  });
});
