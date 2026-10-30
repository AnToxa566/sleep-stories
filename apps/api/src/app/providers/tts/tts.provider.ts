// Thrown for every TTS failure. The message is fixed on purpose: the SDK's error message
// embeds the response body, which can echo the request (SECURITY.md rules 1 and 9).
// `retryable` tells the Cloud Tasks handler whether another attempt can help.
export class TtsProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super('TTS request failed');
    this.name = 'TtsProviderError';
  }
}

export interface SynthesizeInput {
  text: string;
  // The provider's own voice id (voices.provider_voice_id), not our uuid.
  providerVoiceId: string;
}

export interface SynthesizeResult {
  audio: Buffer;
  mimeType: 'audio/mpeg';
  provider: 'elevenlabs';
  model: string;
}

// The abstract class is also the Nest injection token (AGENTS.md architecture rule 2).
// One call, one file: no chunking and no post-processing (architecture rule 5).
export abstract class TtsProvider {
  abstract synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}
