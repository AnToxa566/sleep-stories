import { z } from 'zod';
import { CustomInterestsSchema } from './interests';
import { InterestSlugsSchema, StylesSchema } from './onboarding';
import { SlugSchema } from './slug';

export const PreferencesSchema = z.strictObject({
  voiceSlug: SlugSchema,
  styles: StylesSchema,
  interestSlugs: InterestSlugsSchema,
  customInterests: CustomInterestsSchema,
});

export type Preferences = z.infer<typeof PreferencesSchema>;

// No email and no user id: the client already knows who it is.
export const MeResponseSchema = z.discriminatedUnion('onboardingCompleted', [
  z.strictObject({
    onboardingCompleted: z.literal(false),
    preferences: z.null(),
  }),
  z.strictObject({
    onboardingCompleted: z.literal(true),
    preferences: PreferencesSchema,
  }),
]);

export type MeResponse = z.infer<typeof MeResponseSchema>;
