import { z } from 'zod';

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
  z.strictObject({
    kind: z.literal(JobKindSchema.enum.suggest_topics),
    missing: z.int().min(1).max(3),
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
