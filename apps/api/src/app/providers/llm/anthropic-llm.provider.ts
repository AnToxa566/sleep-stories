import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import type { Env } from '../../config/env';
import {
  LlmProvider,
  LlmProviderError,
  type GenerateStructuredInput,
  type GenerateStructuredResult,
  type GenerateTextInput,
  type GenerateTextResult,
} from './llm.provider';

// One request has to finish well inside a Cloud Run request and a Cloud Tasks deadline.
// Buys a bounded wait; costs a long story on a slow day failing as a (retryable) timeout.
const REQUEST_TIMEOUT_MS = 90_000;

// The only file that imports the Anthropic SDK (AGENTS.md architecture rule 2).
@Injectable()
export class AnthropicLlmProvider extends LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    // maxRetries 0: Cloud Tasks owns retries. The SDK's default of 2 would repeat a paid
    // call that nobody counts. Costs one transient 5xx becoming a task retry.
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.model = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      });
      if (message.stop_reason === 'refusal') {
        throw new LlmProviderError(false);
      }
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      return { text, model: this.model, truncated: message.stop_reason === 'max_tokens' };
    } catch (error) {
      throw toLlmError(error);
    }
  }

  async generateStructured<S extends z.ZodType>(
    input: GenerateStructuredInput<S>,
  ): Promise<GenerateStructuredResult<S>> {
    let parsed: unknown;
    try {
      const message = await this.client.messages.parse({
        model: this.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        output_config: { format: zodOutputFormat(input.schema) },
      });
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        throw new LlmProviderError(false);
      }
      parsed = message.parsed_output;
    } catch (error) {
      throw toLlmError(error);
    }
    // The SDK drops length and count keywords from the schema it sends, so the full
    // schema is applied again here (SECURITY.md rule 5). A bad reply is not retried
    // blindly: it costs money again, and the caller decides.
    const result = input.schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmProviderError(false);
    }
    return { value: result.data, model: this.model };
  }
}

// Maps anything the SDK throws to the fixed-message error. Only the numeric status is
// read: `.message`, `.error`, `.headers` and the cause can carry the response body.
// Retryable: timeouts, connection failures, 408, 429 and 5xx. Everything else, including
// a reply that did not parse (the SDK throws a plain AnthropicError for that), is not.
function toLlmError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) {
    return error;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmProviderError(true);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable = typeof status === 'number' && (status === 408 || status === 429 || status >= 500);
    return new LlmProviderError(retryable, typeof status === 'number' ? status : undefined);
  }
  return new LlmProviderError(false);
}
