import { z } from 'zod';
import { CUSTOM_INTERESTS_MAX_COUNT } from '../../preferences/interests/interests';
import { INTEREST_SLUGS_MAX_COUNT } from '../../preferences/onboarding/onboarding';
import { StoryStyleSchema } from '../../common/story-style/story-style';

// Must match the Prisma enum JobKind in apps/api/prisma/schema.prisma.
// contracts cannot import the generated Prisma client, so the comparison test
// lives in apps/api (src/app/prisma/job-kind.spec.ts).
export const JobKindSchema = z.enum(['suggest_topics', 'write_story', 'render_audio']);

// The payload of a generation job, discriminated by `kind`. The column is JSON,
// so it is parsed when a job is read, never trusted
// (ARCHITECTURE.md section 5, "generation_jobs.payload is parsed, not trusted").
// PROVISIONAL: these are the minimum implied by the decided chaining and may be
// extended when the job handlers are built.
export const GenerationJobPayloadSchema = z.discriminatedUnion('kind', [
  // Two shapes share this kind (ARCHITECTURE.md section 6, "Topics on request"):
  // - the queue top-up: `missing` 1 to 3 topics go into the queue, no `selection`, the
  //   person's whole settings are used;
  // - «Подобрать темы» on «Темы»: `missing` 0 (the new topics only join the list, the person
  //   picks them) and a `selection` that narrows the person's settings for this one run.
  // The refine keeps the pairing, so a top-up can never queue nothing and a request can never
  // fill the queue. The selection holds row ids, never typed text: what a person typed stays
  // in `user_custom_interests` (SECURITY.md rule 9).
  z
    .strictObject({
      kind: z.literal(JobKindSchema.enum.suggest_topics),
      missing: z.int().min(0).max(3),
      selection: z
        .strictObject({
          styles: z.array(StoryStyleSchema).min(1).max(StoryStyleSchema.options.length),
          interestIds: z.array(z.uuid()).max(INTEREST_SLUGS_MAX_COUNT),
          customInterestIds: z.array(z.uuid()).max(CUSTOM_INTERESTS_MAX_COUNT),
        })
        .refine((value) => value.interestIds.length + value.customInterestIds.length >= 1, {
          error: 'Choose at least one interest',
        })
        .optional(),
    })
    .refine((value) => (value.missing === 0) === (value.selection !== undefined), {
      error: 'A selection goes with missing = 0, and only with it',
    }),
  z.strictObject({
    kind: z.literal(JobKindSchema.enum.write_story),
    topicId: z.uuid(),
    voiceId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal(JobKindSchema.enum.render_audio),
    storyId: z.uuid(),
    voiceId: z.uuid(),
  }),
]);

export type JobKind = z.infer<typeof JobKindSchema>;
export type GenerationJobPayload = z.infer<typeof GenerationJobPayloadSchema>;
