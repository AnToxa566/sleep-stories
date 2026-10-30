import { Injectable } from '@nestjs/common';
import { StoryTextSchema } from '@sleep-stories/contracts';
import type { StoryStyle } from '@sleep-stories/contracts';
import { LlmProvider } from '../providers/llm/llm.provider';
import { GenerationError } from './generation-error';
import {
  buildStoryUserMessage,
  STORY_PROMPT_VERSION,
  STORY_SYSTEM_PROMPT,
} from './prompts/story.prompt';

// The TTS limit is 10 000 characters, which is about 3 000 to 4 000 tokens of Russian
// text; 6000 leaves room for the model's tokenisation of Cyrillic. A story that still hits
// the limit is rejected (see below).
const STORY_MAX_TOKENS = 6000;

export interface WriteStoryInput {
  style: StoryStyle;
  // A catalogue title, or text a person typed: untrusted. It only goes into the user
  // message, never into the system prompt (SECURITY.md rule 7).
  topicTitle: string;
}

export interface WriteStoryResult {
  text: string;
  model: string;
  promptVersion: string;
}

@Injectable()
export class StoryWriterService {
  constructor(private readonly llm: LlmProvider) {}

  // One LLM call, one whole story. No length range is checked (owner decision,
  // 2026-10-30): StoryTextSchema only trims and enforces the floor and the TTS cap.
  // Both failures are retryable because a new sample may differ: a longer or shorter
  // reply for the same topic can pass. The errors carry no story text.
  async write(input: WriteStoryInput): Promise<WriteStoryResult> {
    const { text, model, truncated } = await this.llm.generateText({
      system: STORY_SYSTEM_PROMPT,
      user: buildStoryUserMessage(input),
      maxTokens: STORY_MAX_TOKENS,
    });
    // A story cut off by the token limit ends mid-sentence; it must never be voiced.
    if (truncated) {
      throw new GenerationError('story_truncated', true);
    }
    const parsed = StoryTextSchema.safeParse(text);
    if (!parsed.success) {
      throw new GenerationError('story_text_invalid', true);
    }
    return { text: parsed.data, model, promptVersion: STORY_PROMPT_VERSION };
  }
}
