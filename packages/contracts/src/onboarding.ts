import { z } from 'zod';
import { SlugSchema } from './slug';
import { StoryStyleSchema } from './story-style';

const hasUniqueEntries = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const StylesSchema = z
  .array(StoryStyleSchema)
  .min(1)
  .max(StoryStyleSchema.options.length)
  .refine(hasUniqueEntries, { error: 'Styles must be unique' });

export const InterestSlugsSchema = z
  .array(SlugSchema)
  .min(1)
  .max(50)
  .refine(hasUniqueEntries, { error: 'Interest slugs must be unique' });

// strictObject: a body carrying `userId` or any other extra key is rejected.
// The user id comes only from the verified token, never from the body.
export const CompleteOnboardingRequestSchema = z.strictObject({
  voiceSlug: SlugSchema,
  styles: StylesSchema,
  interestSlugs: InterestSlugsSchema,
});

export type CompleteOnboardingRequest = z.infer<typeof CompleteOnboardingRequestSchema>;
