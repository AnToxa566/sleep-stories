import { z } from 'zod';
import { CustomInterestsSchema, InterestSlugsSchema } from '../interests/interests';

// PUT /me/interests replaces both interest lists of a person who finished onboarding. The
// answer is MeResponseSchema.
// strictObject: a body carrying `userId` or any other extra key is rejected.
// The user id comes only from the verified token, never from the body.
// Both lists are required, with no default (onboarding has one for the typed list): here a
// missing field must be an error, never "delete every typed interest".
export const ChangeInterestsRequestSchema = z
  .strictObject({
    interestSlugs: InterestSlugsSchema,
    customInterests: CustomInterestsSchema,
  })
  .refine((body) => body.interestSlugs.length + body.customInterests.length >= 1, {
    error: 'Choose at least one interest',
    path: ['interestSlugs'],
  });

export type ChangeInterestsRequest = z.infer<typeof ChangeInterestsRequestSchema>;
