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
