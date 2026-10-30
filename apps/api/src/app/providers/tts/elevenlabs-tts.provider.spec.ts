import { ElevenLabsClient, ElevenLabsError, ElevenLabsTimeoutError } from '@elevenlabs/elevenlabs-js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ElevenLabsTtsProvider } from './elevenlabs-tts.provider';
import { TtsProviderError } from './tts.provider';

// Fake values that exist only in this file. The SDK client is real but its convert
// method is replaced, so no network is used.
const KEY = 'fake-elevenlabs-key-for-unit-tests';
const MODEL = 'tts-model-under-test';
const LEAK = 'leaky-body-text-9c2e';

const config = {
  get: (name: string) => ({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_MODEL: MODEL })[name],
} as unknown as ConfigService<Env, true>;

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new Uint8Array(chunk));
      }
      controller.close();
    },
  });
}

describe('ElevenLabsTtsProvider', () => {
  let convert: jest.Mock;
  let provider: ElevenLabsTtsProvider;

  beforeEach(() => {
    provider = new ElevenLabsTtsProvider(config);
    convert = jest.fn();
    // Replace only the network call of the real client.
    (provider as unknown as { client: { textToSpeech: { convert: jest.Mock } } }).client.textToSpeech.convert = convert;
  });

  const run = (text = 'text') => provider.synthesize({ text, providerVoiceId: 'voice-1' });
  const failureOf = async (text?: string) => (await run(text).catch((e: unknown) => e)) as TtsProviderError;

  it('requests mp3 with the configured model and voice, and joins the stream chunks in order', async () => {
    convert.mockResolvedValue(streamOf([1, 2], [3], [4, 5]));
    const result = await run('Привет');
    expect(result.audio).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(result).toMatchObject({ mimeType: 'audio/mpeg', provider: 'elevenlabs', model: MODEL });
    expect(convert).toHaveBeenCalledWith(
      'voice-1',
      { text: 'Привет', modelId: MODEL, outputFormat: 'mp3_44100_128' },
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it('builds the client without retries and with an explicit timeout', () => {
    const client = (provider as unknown as { client: ElevenLabsClient }).client;
    const options = (client as unknown as { _options: { maxRetries?: number; timeoutInSeconds?: number } })._options;
    expect(options.maxRetries).toBe(0);
    expect(options.timeoutInSeconds).toBe(180);
  });

  it('accepts exactly 10 000 characters', async () => {
    convert.mockResolvedValue(streamOf([1]));
    await expect(run('a'.repeat(10_000))).resolves.toBeDefined();
  });

  it('rejects 10 001 characters before any network call, without a retry', async () => {
    const failure = await failureOf('a'.repeat(10_001));
    expect(failure).toBeInstanceOf(TtsProviderError);
    expect(failure.retryable).toBe(false);
    expect(convert).not.toHaveBeenCalled();
  });

  it('treats an empty audio stream as a retryable failure', async () => {
    convert.mockResolvedValue(streamOf());
    const failure = await failureOf();
    expect(failure).toBeInstanceOf(TtsProviderError);
    expect(failure.retryable).toBe(true);
  });

  describe('deadline', () => {
    afterEach(() => jest.useRealTimers());

    it('cancels a body that never yields and fails with a retryable fixed-message error', async () => {
      jest.useFakeTimers();
      const cancel = jest.fn(async () => undefined);
      const stalled = {
        getReader: () => ({ read: () => new Promise<never>(() => undefined), cancel }),
      } as unknown as ReadableStream<Uint8Array>;
      convert.mockResolvedValue(stalled);

      const pending = failureOf();
      await jest.advanceTimersByTimeAsync(179_999);
      expect(cancel).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      const failure = await pending;

      expect(failure).toBeInstanceOf(TtsProviderError);
      expect(failure.retryable).toBe(true);
      expect(failure.message).toBe('TTS request failed');
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('turns an SDK error raised after the deadline into the same retryable error', async () => {
      jest.useFakeTimers();
      convert.mockImplementation(
        (_voice: string, _body: unknown, options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener('abort', () => reject(new ElevenLabsError({ message: LEAK, statusCode: 400 })));
          }),
      );
      const pending = failureOf();
      await jest.advanceTimersByTimeAsync(180_000);
      const failure = await pending;
      expect(failure.retryable).toBe(true);
      expect(failure.status).toBeUndefined();
      expect(failure.message).not.toContain(LEAK);
    });

    it('does not leave the timer running after a normal call', async () => {
      jest.useFakeTimers();
      convert.mockResolvedValue(streamOf([1]));
      await run();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('error mapping', () => {
    const sdkError = (statusCode?: number) =>
      new ElevenLabsError({ message: LEAK, statusCode, body: { detail: LEAK }, cause: new Error(LEAK) });

    it.each([
      [408, true],
      [429, true],
      [500, true],
      [503, true],
      [400, false],
      [401, false],
      [422, false],
    ])('maps HTTP %i to retryable=%s', async (status, retryable) => {
      convert.mockRejectedValue(sdkError(status));
      const failure = await failureOf();
      expect(failure).toBeInstanceOf(TtsProviderError);
      expect(failure.retryable).toBe(retryable);
      expect(failure.status).toBe(status);
    });

    it('treats a timeout and an error without a status as retryable', async () => {
      convert.mockRejectedValueOnce(new ElevenLabsTimeoutError(LEAK));
      expect((await failureOf()).retryable).toBe(true);
      convert.mockRejectedValueOnce(sdkError(undefined));
      expect((await failureOf()).retryable).toBe(true);
    });

    it('treats a stream that breaks mid-read as retryable', async () => {
      convert.mockResolvedValue(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error(LEAK));
          },
        }),
      );
      expect((await failureOf()).retryable).toBe(true);
    });

    it('keeps the fake error text, key and body out of the message, stack and fields', async () => {
      convert.mockRejectedValue(sdkError(500));
      const failure = await failureOf();
      const text = `${failure.message} ${failure.name} ${failure.stack ?? ''} ${JSON.stringify(failure)}`;
      for (const secret of [LEAK, KEY]) {
        expect(text).not.toContain(secret);
      }
      expect(failure.message).toBe('TTS request failed');
      expect('cause' in failure).toBe(false);
    });
  });
});
