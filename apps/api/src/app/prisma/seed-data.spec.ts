import { SlugSchema } from '@sleep-stories/contracts';
import {
  INTEREST_SEEDS,
  TTS_PROVIDER,
  VOICE_SEEDS,
  sampleAudioPathFor,
} from '../../../prisma/seed-data';

describe('seed data', () => {
  const voiceSlugs = Object.keys(VOICE_SEEDS);

  it('has voices with valid, unique slugs and non-empty display fields', () => {
    expect(voiceSlugs).toEqual(['maxim', 'anna', 'lev', 'kate']);
    expect(new Set(voiceSlugs).size).toBe(voiceSlugs.length);
    for (const slug of voiceSlugs) {
      expect(SlugSchema.safeParse(slug).success).toBe(true);
      const voice = VOICE_SEEDS[slug as keyof typeof VOICE_SEEDS];
      expect(voice.name.length).toBeGreaterThan(0);
      expect(voice.description.length).toBeGreaterThan(0);
    }
  });

  it('has interest seeds with valid, unique slugs and titles', () => {
    const slugs = Object.keys(INTEREST_SEEDS);
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(SlugSchema.safeParse(slug).success).toBe(true);
      expect(INTEREST_SEEDS[slug as keyof typeof INTEREST_SEEDS].title.length).toBeGreaterThan(0);
    }
  });

  it('uses distinct sort orders', () => {
    const voiceOrders = Object.values(VOICE_SEEDS).map((voice) => voice.sortOrder);
    const interestOrders = Object.values(INTEREST_SEEDS).map((interest) => interest.sortOrder);
    expect(new Set(voiceOrders).size).toBe(voiceOrders.length);
    expect(new Set(interestOrders).size).toBe(interestOrders.length);
  });

  it('gives every voice a real provider voice id, never the old placeholder', () => {
    expect(TTS_PROVIDER).toBe('elevenlabs');
    const ids = Object.values(VOICE_SEEDS).map((voice) => voice.providerVoiceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).not.toBe('unassigned');
      expect(id).toMatch(/^[A-Za-z0-9]{10,}$/);
    }
  });

  it('keeps the sample path in its placeholder form', () => {
    expect(sampleAudioPathFor('maxim')).toBe('voices/maxim/sample.placeholder');
  });
});
