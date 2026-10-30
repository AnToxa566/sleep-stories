import { ElevenLabsClient, ElevenLabsError, ElevenLabsTimeoutError } from '@elevenlabs/elevenlabs-js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORY_TEXT_MAX_CHARS } from '@sleep-stories/contracts';
import type { Env } from '../../config/env';
import { TtsProvider, TtsProviderError, type SynthesizeInput, type SynthesizeResult } from './tts.provider';

// One deadline for the WHOLE call: the request and reading the audio body. A whole story
// is one request and speech takes a while to render. Buys a bounded wait inside the task
// deadline; costs a slow day failing as a (retryable) timeout. The SDK's own
// timeoutInSeconds stops counting once the response headers arrive, so it cannot cover a
// body that stalls; the deadline below does (an AbortController, so the spec can use
// fake timers).
const TTS_TIMEOUT_MS = 180_000;

// Fixed, not configurable: the file extension, the mime type and the duration reader all
// assume MP3 (ARCHITECTURE.md: no ffmpeg, no post-processing).
const OUTPUT_FORMAT = 'mp3_44100_128';

// The only file that imports the ElevenLabs SDK (AGENTS.md architecture rule 2).
@Injectable()
export class ElevenLabsTtsProvider extends TtsProvider {
  private readonly client: ElevenLabsClient;
  private readonly model: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    // maxRetries 0: Cloud Tasks owns retries; a hidden retry would pay for the same
    // audio twice. timeoutInSeconds is only a second guard on the time to the response
    // headers; the per-call deadline in synthesize() is the real limit.
    this.client = new ElevenLabsClient({
      apiKey: config.get('ELEVENLABS_API_KEY', { infer: true }),
      maxRetries: 0,
      timeoutInSeconds: TTS_TIMEOUT_MS / 1000,
    });
    this.model = config.get('ELEVENLABS_MODEL', { infer: true });
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    // Checked before any network call so an oversize text never costs money. Not
    // retryable: the same text fails the same way.
    if (input.text.length > STORY_TEXT_MAX_CHARS) {
      throw new TtsProviderError(false);
    }
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TTS_TIMEOUT_MS);
    try {
      const stream = await this.client.textToSpeech.convert(
        input.providerVoiceId,
        { text: input.text, modelId: this.model, outputFormat: OUTPUT_FORMAT },
        { abortSignal: deadline.signal },
      );
      const audio = await collect(stream, deadline.signal);
      if (audio.length === 0) {
        throw new TtsProviderError(true);
      }
      return { audio, mimeType: 'audio/mpeg', provider: 'elevenlabs', model: this.model };
    } catch (error) {
      // Whatever the SDK or the stream threw after the deadline fired is a timeout.
      throw deadline.signal.aborted ? new TtsProviderError(true) : toTtsError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Reads the whole body, but gives up when `signal` aborts: every read is raced against
// the signal, because a stalled stream never settles a read on its own. On abort the
// reader is cancelled (not awaited, since cancelling a stalled stream may itself hang)
// so the connection is released.
async function collect(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  const reader = stream.getReader();
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new TtsProviderError(true));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  // The race below consumes a rejection; this stops a later one from being unhandled.
  aborted.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), aborted]);
    if (done) {
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Only the numeric status is read: `.message`, `.body` and `.rawResponse` carry the
// response. Retryable: timeouts, no status at all (a network failure), 408, 429 and 5xx.
function toTtsError(error: unknown): TtsProviderError {
  if (error instanceof TtsProviderError) {
    return error;
  }
  if (error instanceof ElevenLabsTimeoutError) {
    return new TtsProviderError(true);
  }
  if (error instanceof ElevenLabsError) {
    const status = error.statusCode;
    if (typeof status !== 'number') {
      return new TtsProviderError(true);
    }
    return new TtsProviderError(status === 408 || status === 429 || status >= 500, status);
  }
  // A stream that broke mid-read or any other thrown value: treat as a network failure.
  return new TtsProviderError(true);
}
