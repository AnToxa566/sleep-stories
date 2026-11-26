import { z } from 'zod';
import { CustomInterestsSchema } from '../interests/interests';
import { SlugSchema } from '../../common/slug/slug';
import { StoryStyleSchema } from '../../common/story-style/story-style';

const hasUniqueEntries = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const StylesSchema = z
  .array(StoryStyleSchema)
  .min(1)
  .max(StoryStyleSchema.options.length)
  .refine(hasUniqueEntries, { error: 'Styles must be unique' });

export const INTEREST_SLUGS_MAX_COUNT = 50;

// May be empty: custom interests alone are enough (the total rule is on the request).
export const InterestSlugsSchema = z
  .array(SlugSchema)
  .max(INTEREST_SLUGS_MAX_COUNT)
  .refine(hasUniqueEntries, { error: 'Interest slugs must be unique' });

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
