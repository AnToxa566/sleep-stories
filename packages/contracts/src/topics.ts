import { z } from 'zod';
import { CustomInterestsSchema } from './interests';
import { InterestSlugsSchema, StylesSchema } from './onboarding';
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

export type TopicsQuery = z.infer<typeof TopicsQuerySchema>;
export type TopicRow = z.infer<typeof TopicRowSchema>;
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;

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
