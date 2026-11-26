import { z } from 'zod';
import { StylesSchema } from '../../common/story-style/story-style';
import { CustomInterestsSchema, InterestSlugsSchema } from '../../preferences/interests/interests';

// POST /api/topics/suggest («Подобрать темы» on «Темы», an explicit action of the person;
// ARCHITECTURE.md section 6, "Topics on request"). The body narrows the person's own
// settings for this one suggestion: at least one style and at least one interest, catalogue
// or typed. Every value must be among the person's settings; the server checks that under
// the users-row lock and answers 400 otherwise. The typed interests are compared after the
// same normalisation as at onboarding. strictObject: no person, no extra key.
export const SuggestTopicsRequestSchema = z
  .strictObject({
    styles: StylesSchema,
    interestSlugs: InterestSlugsSchema,
    customInterests: CustomInterestsSchema,
  })
  .refine((body) => body.interestSlugs.length + body.customInterests.length >= 1, {
    error: 'Choose at least one interest',
    path: ['interestSlugs'],
  });

// GET /api/topics/suggestion, and the answer of POST /api/topics/suggest.
// - `latest`: the person's newest topic suggestion, whoever started it (the queue top-up or
//   this sheet). `running` covers `pending` and `running` jobs, so a retry in progress is
//   still running. The app keeps the id of the suggestion it started and shows «Готово» or
//   the error only for that id. While `latest` is running a new one cannot start (one
//   active suggestion per person), so the app makes its buttons inactive.
// - `suggestions`: the suggestion cap of 5 per rolling 24 hours (owner,
//   2026-11-22). `nextAt` is when the oldest counted suggestion leaves the window; it is set
//   only when nothing is left, for «Попытки закончились · следующая в 02:14».
// For display only: the server enforces the cap when a suggestion starts.
export const SuggestionStateSchema = z.enum(['running', 'succeeded', 'failed']);

export const SuggestionStatusResponseSchema = z.strictObject({
  latest: z
    .strictObject({
      id: z.uuid(),
      state: SuggestionStateSchema,
    })
    .nullable(),
  suggestions: z.strictObject({
    left: z.number().int().min(0),
    limit: z.number().int().min(1),
    nextAt: z.iso.datetime().nullable(),
  }),
});

export type SuggestTopicsRequest = z.infer<typeof SuggestTopicsRequestSchema>;
export type SuggestionState = z.infer<typeof SuggestionStateSchema>;
export type SuggestionStatusResponse = z.infer<typeof SuggestionStatusResponseSchema>;
