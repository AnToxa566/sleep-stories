import { VoiceSchema, VoicesResponseSchema } from './voices';

const voice = { slug: 'anna', name: 'Анна', description: 'Мягкий, неторопливый голос',
  sampleUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/audio/voices/anna/sample.mp3?token=abc',
};

describe('VoiceSchema', () => {
  it('accepts a slug, a name, a description and a sample URL', () => {
    expect(VoiceSchema.safeParse(voice).success).toBe(true);
  });

  it.each(['providerVoiceId', 'ttsProvider', 'sampleAudioPath'])(
    'rejects the server-only key %s',
    (key) => {
      expect(VoiceSchema.safeParse({ ...voice, [key]: 'x' }).success).toBe(false);
    },
  );

  it('rejects a bad slug', () => {
    expect(VoiceSchema.safeParse({ ...voice, slug: 'Anna' }).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...voice, slug: 'a_b' }).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...voice, slug: '' }).success).toBe(false);
  });

  it('rejects a missing or malformed sample URL', () => {
    const withoutUrl: Record<string, unknown> = { ...voice };
    delete withoutUrl['sampleUrl'];
    expect(VoiceSchema.safeParse(withoutUrl).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...voice, sampleUrl: 'voices/anna/sample.mp3' }).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...voice, sampleUrl: '' }).success).toBe(false);
  });

  it('rejects an empty name or description', () => {
    expect(VoiceSchema.safeParse({ ...voice, name: '' }).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...voice, description: '' }).success).toBe(false);
  });
});

describe('VoicesResponseSchema', () => {
  it('accepts a list, including an empty one', () => {
    expect(VoicesResponseSchema.safeParse({ voices: [voice] }).success).toBe(true);
    expect(VoicesResponseSchema.safeParse({ voices: [] }).success).toBe(true);
  });

  it('rejects an extra key, a missing list and a voice with an extra key', () => {
    expect(VoicesResponseSchema.safeParse({ voices: [], extra: 1 }).success).toBe(false);
    expect(VoicesResponseSchema.safeParse({}).success).toBe(false);
    expect(
      VoicesResponseSchema.safeParse({ voices: [{ ...voice, sampleAudioPath: 'x' }] }).success,
    ).toBe(false);
  });
});
