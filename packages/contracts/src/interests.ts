import { z } from 'zod';
import { SlugSchema } from './slug';

// One catalogue interest as served by GET /api/interests.
export const InterestSchema = z.strictObject({
  slug: SlugSchema,
  title: z.string().min(1).max(100),
});

export const InterestsResponseSchema = z.strictObject({
  interests: z.array(InterestSchema),
});

export type Interest = z.infer<typeof InterestSchema>;
export type InterestsResponse = z.infer<typeof InterestsResponseSchema>;

export const CUSTOM_INTEREST_MAX_LENGTH = 60;
export const CUSTOM_INTERESTS_MAX_COUNT = 20;

// A free-text topic written by the user. UNTRUSTED DATA: it is never
// concatenated into system instructions and never logged. Limits only, no
// moderation (owner decision, 2026-10-30).
// Normalised on parse: trimmed, Unicode NFC, lowercased, then length-checked (the 60
// characters apply after normalisation). Control characters (including newlines and tabs)
// and the Unicode line and paragraph separators are rejected. Zero-width and other format
// characters are NOT rejected.
export const CustomInterestSchema = z
  .string()
  .trim()
  .normalize('NFC')
  .toLowerCase()
  .min(1)
  .max(CUSTOM_INTEREST_MAX_LENGTH)
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u, { error: 'Control characters are not allowed' });

export const CustomInterestsSchema = z
  .array(CustomInterestSchema)
  .max(CUSTOM_INTERESTS_MAX_COUNT)
  .refine((values) => new Set(values).size === values.length, {
    error: 'Custom interests must be unique',
  });

export type CustomInterest = z.infer<typeof CustomInterestSchema>;
