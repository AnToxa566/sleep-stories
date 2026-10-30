import type { z } from 'zod';

// Thrown for every LLM failure. The message is fixed on purpose: provider errors embed
// the response body and sometimes request details, and Nest logs an unhandled error's
// message (SECURITY.md rules 1 and 9). `retryable` is what the Cloud Tasks handler needs
// to choose between "retry the task" and "give up"; `status` is the HTTP status when
// there was one, a number carries no secret.
export class LlmProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super('LLM request failed');
    this.name = 'LlmProviderError';
  }
}

export interface GenerateTextInput {
  system: string;
  user: string;
  maxTokens: number;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  // True when the reply was cut off by maxTokens. The caller decides what that means.
  truncated: boolean;
}

export interface GenerateStructuredInput<S extends z.ZodType> {
  system: string;
  user: string;
  maxTokens: number;
  schema: S;
}

export interface GenerateStructuredResult<S extends z.ZodType> {
  value: z.output<S>;
  model: string;
}

// The abstract class is also the Nest injection token, so a feature depends on this
// file and never on a vendor SDK (AGENTS.md architecture rule 2). Untrusted text goes
// into `user`, never into `system` (SECURITY.md rule 7).
export abstract class LlmProvider {
  abstract generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  abstract generateStructured<S extends z.ZodType>(
    input: GenerateStructuredInput<S>,
  ): Promise<GenerateStructuredResult<S>>;
}
