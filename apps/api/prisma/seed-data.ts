// Reference data for the voice and interest catalogues. Interests are served by the
// API from the database, so their slugs are free here. Voice slugs are stored in the
// database and validated by the API against the `voices` table, not against a shared
// list, so this file imports nothing from packages/contracts (the seed runs under
// ts-node, which does not resolve tsconfig paths).

export interface VoiceSeed {
  name: string;
  description: string;
  sortOrder: number;
  // The voice id on the TTS provider's side. Server-only: it is never served to the app.
  providerVoiceId: string;
}

export interface InterestSeed {
  title: string;
  sortOrder: number;
}

export const TTS_PROVIDER = 'elevenlabs';

export const VOICE_SEEDS = {
  maxim: { name: 'Максим', description: 'спокойный, размеренный', sortOrder: 1, providerVoiceId: 'HcaxAsrhw4ByUo4CBCBN' },
  anna: { name: 'Анна', description: 'тёплый, нежный', sortOrder: 2, providerVoiceId: '7CPD49d3y4krj7MKJYOV' },
  lev: { name: 'Лев', description: 'литературный, выразительный', sortOrder: 3, providerVoiceId: '1kb4Md8n0kMNktygYhDF' },
  kate: { name: 'Катя', description: 'мягкий, молодой', sortOrder: 4, providerVoiceId: 'WfExDXCt2GBg6MI5KjQk' },
} satisfies Record<string, VoiceSeed>;

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

// No recorded sample exists yet (sample upload is deferred), so the path is a placeholder
// in the final form. The column is NOT NULL, so it cannot be left out.
export function sampleAudioPathFor(slug: string): string {
  return `voices/${slug}/sample.placeholder`;
}
