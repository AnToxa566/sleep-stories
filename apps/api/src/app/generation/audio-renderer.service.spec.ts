import { randomUUID } from 'node:crypto';
import { StorageService } from '../providers/storage/storage.service';
import type { SynthesizeInput } from '../providers/tts/tts.provider';
import { TtsProvider } from '../providers/tts/tts.provider';
import { AudioDurationReader } from './audio-duration';
import { AudioRendererService } from './audio-renderer.service';
import { GenerationError } from './generation-error';

const AUDIO = Buffer.from('fake-audio-bytes');
const TEXT = 'story-text-marker-91ab';

function setup(duration: number | undefined | Error) {
  const synth: SynthesizeInput[] = [];
  const uploads: { path: string; bytes: Buffer; mimeType: string }[] = [];
  const tts = {
    synthesize: async (input: SynthesizeInput) => {
      synth.push(input);
      return { audio: AUDIO, mimeType: 'audio/mpeg', provider: 'elevenlabs', model: 'm' };
    },
  } as unknown as TtsProvider;
  const durations = {
    read: async () => {
      if (duration instanceof Error) throw duration;
      return duration;
    },
  } as unknown as AudioDurationReader;
  const storage = {
    uploadAudio: async (path: string, bytes: Buffer, mimeType: string) => {
      uploads.push({ path, bytes, mimeType });
    },
  } as unknown as StorageService;
  return { service: new AudioRendererService(tts, durations, storage), synth, uploads };
}

const storyId = randomUUID();
const voiceId = randomUUID();
const render = (service: AudioRendererService) =>
  service.render({ storyId, voice: { id: voiceId, providerVoiceId: 'prov-1' }, text: TEXT });

describe('AudioRendererService', () => {
  it('synthesizes with the provider voice id, uploads at the deterministic path and returns the metadata', async () => {
    const { service, synth, uploads } = setup(181.4);
    const result = await render(service);
    expect(synth).toEqual([{ text: TEXT, providerVoiceId: 'prov-1' }]);
    expect(uploads).toEqual([
      { path: `stories/${storyId}/${voiceId}.mp3`, bytes: AUDIO, mimeType: 'audio/mpeg' },
    ]);
    expect(result).toEqual({
      storagePath: `stories/${storyId}/${voiceId}.mp3`,
      durationSec: 181,
      byteSize: AUDIO.length,
      mimeType: 'audio/mpeg',
      ttsProvider: 'elevenlabs',
    });
  });

  it('rounds the duration to whole seconds', async () => {
    expect((await render(setup(181.5).service)).durationSec).toBe(182);
    expect((await render(setup(181.49).service)).durationSec).toBe(181);
  });

  it('never returns less than one second', async () => {
    expect((await render(setup(0.2).service)).durationSec).toBe(1);
  });

  it('throws a non-retryable error and uploads nothing when the duration is missing', async () => {
    const { service, uploads } = setup(undefined);
    await expect(render(service)).rejects.toMatchObject({
      code: 'audio_duration_unreadable',
      retryable: false,
    });
    expect(uploads).toHaveLength(0);
  });

  it('maps a parser exception to the same fixed error', async () => {
    const { service } = setup(new Error(`parser failed on ${TEXT}`));
    const error = await render(service).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as Error).message).not.toContain(TEXT);
  });

  it('refuses a non-UUID id before any paid call', async () => {
    const { service, synth } = setup(10);
    await expect(
      service.render({ storyId: '../x', voice: { id: voiceId, providerVoiceId: 'p' }, text: TEXT }),
    ).rejects.toThrow();
    expect(synth).toHaveLength(0);
  });

  it('never puts the text or the path into an error message', async () => {
    const error = await render(setup(undefined).service).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).not.toContain(TEXT);
    expect(message).not.toContain(storyId);
  });
});
