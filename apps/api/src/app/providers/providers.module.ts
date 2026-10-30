import { Global, Module } from '@nestjs/common';
import { AnthropicLlmProvider } from './llm/anthropic-llm.provider';
import { LlmProvider } from './llm/llm.provider';
import { StorageService } from './storage/storage.service';
import { ElevenLabsTtsProvider } from './tts/elevenlabs-tts.provider';
import { TtsProvider } from './tts/tts.provider';

// Adapters for services that hold provider keys. Global so a feature module can inject
// an adapter without importing this module. Features inject the abstract LlmProvider and
// TtsProvider, never the vendor classes, so a vendor can be swapped here alone.
@Global()
@Module({
  providers: [
    StorageService,
    { provide: LlmProvider, useClass: AnthropicLlmProvider },
    { provide: TtsProvider, useClass: ElevenLabsTtsProvider },
  ],
  exports: [StorageService, LlmProvider, TtsProvider],
})
export class ProvidersModule {}
