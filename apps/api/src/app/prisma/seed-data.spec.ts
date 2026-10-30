import { PLACEHOLDER_INTEREST_SLUGS, PLACEHOLDER_VOICE_SLUGS } from '@sleep-stories/contracts';
import { INTEREST_SEEDS, VOICE_SEEDS, placeholderProviderFields } from '../../../prisma/seed-data';

// The seed and the mobile app share the slug lists from packages/contracts. The
// `satisfies Record<Slug, ...>` in seed-data.ts catches drift at compile time;
// this compares the runtime lists as well.
describe('placeholder seed data', () => {
  it('has exactly one voice seed per placeholder voice slug', () => {
    expect(Object.keys(VOICE_SEEDS).sort()).toEqual([...PLACEHOLDER_VOICE_SLUGS].sort());
  });

  it('has exactly one interest seed per placeholder interest slug', () => {
    expect(Object.keys(INTEREST_SEEDS).sort()).toEqual([...PLACEHOLDER_INTEREST_SLUGS].sort());
  });

  it('uses distinct sort orders', () => {
    const voiceOrders = Object.values(VOICE_SEEDS).map((voice) => voice.sortOrder);
    const interestOrders = Object.values(INTEREST_SEEDS).map((interest) => interest.sortOrder);
    expect(new Set(voiceOrders).size).toBe(voiceOrders.length);
    expect(new Set(interestOrders).size).toBe(interestOrders.length);
  });

  it('marks every voice as having no provider and no sample yet', () => {
    for (const slug of PLACEHOLDER_VOICE_SLUGS) {
      expect(placeholderProviderFields(slug)).toEqual({
        ttsProvider: 'none',
        providerVoiceId: 'unassigned',
        sampleAudioPath: `voices/${slug}/sample.placeholder`,
      });
    }
  });
});
