// TEMPORARY placeholders. Voices and interests live in the database and clients
// send their slugs. Until an API serves that reference data, the mobile app
// and the seed script share these lists so the two cannot drift apart.
// Remove this file when the reference-data endpoint exists.

export const PLACEHOLDER_VOICE_SLUGS = ['anna', 'mikhail', 'vera', 'lev'] as const;

export const PLACEHOLDER_INTEREST_SLUGS = [
  'history',
  'space',
  'philosophy',
  'science',
  'myths',
  'nature',
  'technology',
  'music',
  'art',
  'ocean',
] as const;

export type PlaceholderVoiceSlug = (typeof PLACEHOLDER_VOICE_SLUGS)[number];
export type PlaceholderInterestSlug = (typeof PLACEHOLDER_INTEREST_SLUGS)[number];
