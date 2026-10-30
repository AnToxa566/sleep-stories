// TEMPORARY placeholder. Voices live in the database and clients send their slugs.
// Until an API serves voices, the mobile app and the seed script share this list
// so the two cannot drift apart. Interests are already served by the API.
// Remove this file when the voices endpoint exists.

export const PLACEHOLDER_VOICE_SLUGS = ['anna', 'mikhail', 'vera', 'lev'] as const;

export type PlaceholderVoiceSlug = (typeof PLACEHOLDER_VOICE_SLUGS)[number];
