import { z } from 'zod';
import { StoryStyleSchema } from '../../common/story-style/story-style';

// GET /api/topics?style=&ready=&heard= : the list «Темы». Query values arrive as strings, so
// `ready` and `heard` are the text 'true' or 'false' and the server turns them into flags.
// `ready` 'true' keeps only topics that can be played at once, 'false' only the others, unset
// all. `heard` works the same way for topics the person has heard (LISTEN_FINISHED_SHARE).
// Unknown keys are refused (a typo in a filter must not silently return an unfiltered list).
export const TopicsQuerySchema = z.strictObject({
  style: StoryStyleSchema.optional(),
  ready: z.enum(['true', 'false']).optional(),
  heard: z.enum(['true', 'false']).optional(),
});

// One row of the list. The state is derived from the data in the person's voice and never
// stored (ARCHITECTURE.md section 6, "Readiness and the four states"). Only a `ready` topic
// has a duration; the other states carry `null`, so the two shapes are strict and a row
// cannot claim a duration while it is not ready. `inQueue` tells whether the person's queue
// holds the topic now. `heard` is derived from the person's listens, never stored.
const TopicRowBase = {
  id: z.uuid(),
  title: z.string(),
  style: StoryStyleSchema,
  inQueue: z.boolean(),
  heard: z.boolean(),
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

// The path of DELETE /api/topics/:topicId/heard («Отметить как не прослушанную»;
// ARCHITECTURE.md section 6). The request has no body and the answer is 204 with no body.
export const TopicParamsSchema = z.strictObject({ topicId: z.uuid() });

export type TopicsQuery = z.infer<typeof TopicsQuerySchema>;
export type TopicRow = z.infer<typeof TopicRowSchema>;
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;
