import { z } from 'zod';
import { SlugSchema } from '../../common/slug/slug';
import { StylesSchema } from '../../common/story-style/story-style';
import { CustomInterestsSchema, InterestSlugsSchema } from '../interests/interests';

// strictObject: a body carrying `userId` or any other extra key is rejected.
// The user id comes only from the verified token, never from the body.
export const CompleteOnboardingRequestSchema = z
  .strictObject({
    voiceSlug: SlugSchema,
    styles: StylesSchema,
    interestSlugs: InterestSlugsSchema,
    customInterests: CustomInterestsSchema.default([]),
  })
  .refine((body) => body.interestSlugs.length + body.customInterests.length >= 1, {
    error: 'Choose at least one interest',
    path: ['interestSlugs'],
  });

export type CompleteOnboardingRequest = z.infer<typeof CompleteOnboardingRequestSchema>;
