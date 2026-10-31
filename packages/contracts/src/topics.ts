import { z } from 'zod';
import { SlugSchema } from './slug';
import { StoryStyleSchema } from './story-style';

export const SUGGESTED_TOPIC_TITLE_MAX_LENGTH = 120;
export const SUGGESTED_TOPICS_MAX_COUNT = 20;

// One topic proposed by the LLM. This is MODEL OUTPUT, so it is parsed, never
// trusted: trimmed, one line, no control characters (same rule as
// CustomInterestSchema), and `interest` is a catalogue slug or null. Whether the
// slug is really in the offered list is checked by the service, not here.
export const SuggestedTopicSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(SUGGESTED_TOPIC_TITLE_MAX_LENGTH)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u, { error: 'Control characters are not allowed' }),
  style: StoryStyleSchema,
  interest: SlugSchema.nullable(),
});

// Only an upper bound on the count. The prompt asks for 10 to 15, but a wrong
// count must not throw away a paid reply: the service filters and de-duplicates.
export const SuggestedTopicsSchema = z.strictObject({
  topics: z.array(SuggestedTopicSchema).max(SUGGESTED_TOPICS_MAX_COUNT),
});

export type SuggestedTopic = z.infer<typeof SuggestedTopicSchema>;
export type SuggestedTopics = z.infer<typeof SuggestedTopicsSchema>;

// GET /api/topics?style=&ready= : the list «Темы». Query values arrive as strings, so `ready`
// is the text 'true' or 'false' and the server turns it into a flag. Unknown keys are refused
// (a typo in a filter must not silently return an unfiltered list).
export const TopicsQuerySchema = z.strictObject({
  style: StoryStyleSchema.optional(),
  ready: z.enum(['true', 'false']).optional(),
});

// One row of the list. The state is derived from the data in the person's voice and never
// stored (ARCHITECTURE.md section 6, "Readiness and the four states"). Only a `ready` topic
// has a duration; the other states carry `null`, so the two shapes are strict and a row
// cannot claim a duration while it is not ready. `inQueue` tells whether the person's queue
// holds the topic now.
const TopicRowBase = {
  id: z.uuid(),
  title: z.string(),
  style: StoryStyleSchema,
  inQueue: z.boolean(),
};

export const ReadyTopicRowSchema = z.strictObject({
  ...TopicRowBase,
  state: z.literal('ready'),
  durationSec: z.number().int().positive(),
});

export const NotReadyTopicRowSchema = z.strictObject({
  ...TopicRowBase,
  state: z.enum(['creating', 'failed', 'not_ready']),
  durationSec: z.null(),
});

export const TopicRowSchema = z.discriminatedUnion('state', [
  ReadyTopicRowSchema,
  NotReadyTopicRowSchema,
]);

export const TopicsResponseSchema = z.strictObject({
  topics: z.array(TopicRowSchema),
});

export type TopicsQuery = z.infer<typeof TopicsQuerySchema>;
export type TopicRow = z.infer<typeof TopicRowSchema>;
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;
