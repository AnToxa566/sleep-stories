import { Injectable } from '@nestjs/common';
import { SuggestedTopicsSchema } from '@sleep-stories/contracts';
import type { SuggestedTopic } from '@sleep-stories/contracts';
import { LlmProvider } from '../providers/llm/llm.provider';
import { GenerationError } from './generation-error';
import {
  buildTopicsUserMessage,
  TOPICS_PROMPT_VERSION,
  TOPICS_SYSTEM_PROMPT,
} from './prompts/topics.prompt';
import type { TopicsPromptInput } from './prompts/topics.prompt';

// 10 to 15 short titles fit comfortably; the margin is for a verbose reply, because a
// reply cut off by the limit fails the structured parse and wastes the paid call.
const TOPICS_MAX_TOKENS = 4000;

export interface SuggestTopicsResult {
  topics: SuggestedTopic[];
  model: string;
  promptVersion: string;
}

@Injectable()
export class TopicSuggesterService {
  constructor(private readonly llm: LlmProvider) {}

  // Asks the model for topics and keeps only the usable ones. The model is not trusted
  // to follow the lists in the prompt, so the service re-checks them: a topic whose style
  // was not requested, or whose interest slug was not offered, is dropped, and so is a
  // duplicate (case-insensitive) of an earlier topic in the same batch or of an
  // already-offered title. The count is not forced to 10 to 15: a short batch is fine,
  // an empty one is a retryable error (a new sample usually fixes it).
  async suggest(input: TopicsPromptInput): Promise<SuggestTopicsResult> {
    const { value, model } = await this.llm.generateStructured({
      system: TOPICS_SYSTEM_PROMPT,
      user: buildTopicsUserMessage(input),
      maxTokens: TOPICS_MAX_TOKENS,
      schema: SuggestedTopicsSchema,
    });

    const styles = new Set<string>(input.styles);
    const slugs = new Set(input.interests.map((interest) => interest.slug));
    const seen = new Set(input.existingTopics.map((topic) => normalise(topic.title)));
    const topics: SuggestedTopic[] = [];
    for (const topic of value.topics) {
      if (!styles.has(topic.style)) continue;
      if (topic.interest !== null && !slugs.has(topic.interest)) continue;
      const key = normalise(topic.title);
      if (seen.has(key)) continue;
      seen.add(key);
      topics.push(topic);
    }

    if (topics.length === 0) {
      throw new GenerationError('no_valid_topics', true);
    }
    return { topics, model, promptVersion: TOPICS_PROMPT_VERSION };
  }
}

function normalise(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}
