import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { LlmProviderError } from './llm.provider';

// Fake values that exist only in this file. The SDK client is real but its two
// request methods are replaced, so no network is used.
const KEY = 'fake-anthropic-key-for-unit-tests';
const MODEL = 'model-under-test';
const LEAK = 'leaky-body-text-4d1f';

const config = {
  get: (name: string) => ({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: MODEL })[name],
} as unknown as ConfigService<Env, true>;

const input = { system: 'sys', user: 'usr', maxTokens: 100 };

function reply(stop_reason: string, content: unknown[], parsed_output?: unknown) {
  return { stop_reason, content, parsed_output };
}

describe('AnthropicLlmProvider', () => {
  let create: jest.SpyInstance;
  let parse: jest.SpyInstance;
  let provider: AnthropicLlmProvider;

  beforeEach(() => {
    create = jest.spyOn(Anthropic.Messages.prototype, 'create');
    parse = jest.spyOn(Anthropic.Messages.prototype, 'parse');
    provider = new AnthropicLlmProvider(config);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('generateText', () => {
    it('sends the system prompt and user message apart, and returns the joined text blocks', async () => {
      create.mockResolvedValue(
        reply('end_turn', [
          { type: 'text', text: 'Hello, ' },
          { type: 'thinking', thinking: 'ignored' },
          { type: 'text', text: 'world' },
        ]),
      );
      const result = await provider.generateText(input);
      expect(result).toEqual({ text: 'Hello, world', model: MODEL, truncated: false });
      expect(create).toHaveBeenCalledWith({
        model: MODEL,
        max_tokens: 100,
        system: 'sys',
        messages: [{ role: 'user', content: 'usr' }],
      });
    });

    it('flags a reply cut off by max_tokens', async () => {
      create.mockResolvedValue(reply('max_tokens', [{ type: 'text', text: 'half a sto' }]));
      expect((await provider.generateText(input)).truncated).toBe(true);
    });

    it('treats a refusal as a non-retryable failure', async () => {
      create.mockResolvedValue(reply('refusal', []));
      const failure = await provider.generateText(input).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect((failure as LlmProviderError).retryable).toBe(false);
    });

    it('builds the client without retries and with an explicit timeout', () => {
      const clientOf = (p: AnthropicLlmProvider) => (p as unknown as { client: Anthropic }).client;
      expect(clientOf(provider).maxRetries).toBe(0);
      expect(clientOf(provider).timeout).toBe(90_000);
    });
  });

  describe('error mapping', () => {
    const apiError = (status: number) =>
      Anthropic.APIError.generate(status, { error: LEAK }, LEAK, new Headers({ 'x-leak': LEAK }));

    it.each([
      [408, true],
      [429, true],
      [500, true],
      [529, true],
      [400, false],
      [401, false],
      [404, false],
    ])('maps HTTP %i to retryable=%s', async (status, retryable) => {
      create.mockRejectedValue(apiError(status));
      const failure = (await provider.generateText(input).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(failure.retryable).toBe(retryable);
      expect(failure.status).toBe(status);
    });

    it.each([
      ['a timeout', () => new Anthropic.APIConnectionTimeoutError()],
      ['a connection error', () => new Anthropic.APIConnectionError({ message: LEAK, cause: new Error(LEAK) })],
    ])('treats %s as retryable', async (_name, make) => {
      create.mockRejectedValue(make());
      const failure = (await provider.generateText(input).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure.retryable).toBe(true);
      expect(failure.status).toBeUndefined();
    });

    it('treats an unknown thrown value as non-retryable', async () => {
      create.mockRejectedValue(new Error(LEAK));
      const failure = (await provider.generateText(input).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(failure.retryable).toBe(false);
    });

    it('keeps the fake error text, key and headers out of the message, name, stack and fields', async () => {
      create.mockRejectedValue(apiError(500));
      const failure = (await provider.generateText(input).catch((e: unknown) => e)) as LlmProviderError;
      const text = `${failure.message} ${failure.name} ${failure.stack ?? ''} ${JSON.stringify(failure)}`;
      for (const secret of [LEAK, KEY, 'x-leak']) {
        expect(text).not.toContain(secret);
      }
      expect(failure.message).toBe('LLM request failed');
      expect('cause' in failure).toBe(false);
    });
  });

  describe('generateStructured', () => {
    const schema = z.object({ items: z.array(z.string()).max(2) });

    it('sends a JSON-schema output format and returns the validated value', async () => {
      parse.mockResolvedValue(reply('end_turn', [], { items: ['a'] }));
      const result = await provider.generateStructured({ ...input, schema });
      expect(result).toEqual({ value: { items: ['a'] }, model: MODEL });
      const params = parse.mock.calls[0][0] as { output_config: { format: { type: string } }; system: string };
      expect(params.output_config.format.type).toBe('json_schema');
      expect(params.system).toBe('sys');
    });

    it('applies the full schema again, because the SDK drops count and length keywords', async () => {
      parse.mockResolvedValue(reply('end_turn', [], { items: ['a', 'b', 'c'] }));
      const failure = (await provider.generateStructured({ ...input, schema }).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(failure.retryable).toBe(false);
    });

    it.each([
      ['a missing parsed output', reply('end_turn', [], null)],
      ['a refusal', reply('refusal', [], null)],
      ['a truncated reply', reply('max_tokens', [], { items: [] })],
    ])('fails without retry on %s', async (_name, message) => {
      parse.mockResolvedValue(message);
      const failure = (await provider.generateStructured({ ...input, schema }).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(failure.retryable).toBe(false);
    });

    it('maps the SDK parse error to a non-retryable error with a fixed message', async () => {
      parse.mockRejectedValue(new Anthropic.AnthropicError(`bad reply ${LEAK}`));
      const failure = (await provider.generateStructured({ ...input, schema }).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(failure.retryable).toBe(false);
      expect(failure.message).not.toContain(LEAK);
    });

    it('maps an API error to a retryable one for 503', async () => {
      parse.mockRejectedValue(Anthropic.APIError.generate(503, { error: LEAK }, LEAK, new Headers()));
      const failure = (await provider.generateStructured({ ...input, schema }).catch((e: unknown) => e)) as LlmProviderError;
      expect(failure.retryable).toBe(true);
    });
  });
});
