import { Injectable } from '@nestjs/common';
import { StorageService, storyAudioPath } from '../providers/storage/storage.service';
import { TtsProvider } from '../providers/tts/tts.provider';
import { AudioDurationReader } from './audio-duration';
import { GenerationError } from './generation-error';

export interface RenderAudioInput {
  storyId: string;
  // Our voice id (the path part) and the provider's own id (what the TTS call needs).
  voice: { id: string; providerVoiceId: string };
  text: string;
}

export interface RenderAudioResult {
  // Relative to the audio bucket; this is what story_audio stores, never a URL.
  storagePath: string;
  durationSec: number;
  byteSize: number;
  mimeType: string;
  ttsProvider: string;
}

@Injectable()
export class AudioRendererService {
  constructor(
    private readonly tts: TtsProvider,
    private readonly durations: AudioDurationReader,
    private readonly storage: StorageService,
  ) {}

  // One TTS request, one file, no post-processing. Writes no database row: the handler
  // that calls this stores the result in one transaction with the job's status.
  async render(input: RenderAudioInput): Promise<RenderAudioResult> {
    // The path is computed first: it validates both ids before any paid call is made.
    const storagePath = storyAudioPath(input.storyId, input.voice.id);

    const { audio, mimeType, provider } = await this.tts.synthesize({
      text: input.text,
      providerVoiceId: input.voice.providerVoiceId,
    });

    const seconds = await this.readDuration(audio);
    await this.storage.uploadAudio(storagePath, audio, mimeType);

    return {
      storagePath,
      durationSec: Math.max(1, Math.round(seconds)),
      byteSize: audio.length,
      mimeType,
      ttsProvider: provider,
    };
  }

  // Not retryable: the same TTS call that produced unreadable audio costs money again,
  // and a corrupt reply is rare enough to be looked at rather than looped. A parser
  // exception is mapped too, because its message can embed file details.
  private async readDuration(audio: Buffer): Promise<number> {
    let seconds: number | undefined;
    try {
      seconds = await this.durations.read(audio);
    } catch {
      throw new GenerationError('audio_duration_unreadable', false);
    }
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
      throw new GenerationError('audio_duration_unreadable', false);
    }
    return seconds;
  }
}
