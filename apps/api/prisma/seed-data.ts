// Placeholder reference data for the sign-up and onboarding feature. The voice
// slugs come from the shared list in packages/contracts, which the mobile app also
// uses, so the two cannot drift apart: `satisfies Record<Slug, ...>` makes a
// missing or extra slug a type error here, and a spec compares the runtime lists.
// Interests are served by the API from the database, so their slugs are free here.
// `import type` keeps this file free of a runtime path-alias dependency, because
// the seed runs under ts-node, which does not resolve tsconfig paths.
import type { PlaceholderVoiceSlug } from '@sleep-stories/contracts';

export interface VoiceSeed {
  name: string;
  description: string;
  sortOrder: number;
}

export interface InterestSeed {
  title: string;
  sortOrder: number;
}

export const VOICE_SEEDS = {
  anna: { name: 'Анна', description: 'тёплый, тихий', sortOrder: 1 },
  mikhail: { name: 'Михаил', description: 'низкий, неторопливый', sortOrder: 2 },
  vera: { name: 'Вера', description: 'мягкий, почти шёпот', sortOrder: 3 },
  lev: { name: 'Лев', description: 'ровный, спокойный', sortOrder: 4 },
} satisfies Record<PlaceholderVoiceSlug, VoiceSeed>;

export const INTEREST_SEEDS = {
  history: { title: 'История', sortOrder: 1 },
  space: { title: 'Космос', sortOrder: 2 },
  philosophy: { title: 'Философия', sortOrder: 3 },
  science: { title: 'Наука', sortOrder: 4 },
  myths: { title: 'Мифы', sortOrder: 5 },
  nature: { title: 'Природа', sortOrder: 6 },
  technology: { title: 'Технологии', sortOrder: 7 },
  music: { title: 'Музыка', sortOrder: 8 },
  art: { title: 'Искусство', sortOrder: 9 },
  ocean: { title: 'Океан', sortOrder: 10 },
} satisfies Record<string, InterestSeed>;

// The TTS provider is not chosen yet (ARCHITECTURE.md section 11, open problem 5),
// so no voice has a real provider voice id or a recorded sample. These values
// are placeholders; the columns are NOT NULL, so they cannot be left out.
// The seed writes them only when it creates a row and never overwrites them on a
// re-run, so a real configuration made later is not lost.
export function placeholderProviderFields(slug: PlaceholderVoiceSlug) {
  return {
    ttsProvider: 'none',
    providerVoiceId: 'unassigned',
    sampleAudioPath: `voices/${slug}/sample.placeholder`,
  };
}
