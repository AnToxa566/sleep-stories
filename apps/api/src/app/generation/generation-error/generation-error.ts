// Thrown by the generation services when a model or TTS reply cannot be used. The message
// is fixed per code and carries no model text, story text, title, path or key: Nest logs
// an unhandled error's message (SECURITY.md rules 1 and 9). `retryable` is what the
// Cloud Tasks handler (a later feature) needs to choose between "retry the task" and
// "give up". Provider failures are a different class (LlmProviderError and friends).
export type GenerationErrorCode =
  | 'no_valid_topics'
  | 'story_truncated'
  | 'story_text_invalid'
  | 'audio_duration_unreadable'
  | 'job_target_missing';

const MESSAGES: Record<GenerationErrorCode, string> = {
  no_valid_topics: 'The model returned no usable topics',
  story_truncated: 'The story was cut off by the token limit',
  story_text_invalid: 'The story text is outside the allowed bounds',
  audio_duration_unreadable: 'The audio duration could not be read',
  job_target_missing: 'The target of the job no longer exists',
};

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    readonly retryable: boolean,
  ) {
    super(MESSAGES[code]);
    this.name = 'GenerationError';
  }
}
