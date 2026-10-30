import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { Env } from '../config/env';
import { JobQueue } from './job-queue/job-queue';
import { createJobQueue } from './job-queue/job-queue.factory';
import { LocalDispatchSecret } from './job-queue/local-dispatch-secret';
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
    // One per process, shared by the local queue (which sends it) and the internal
    // credential verifier (which accepts it, in local mode only).
    LocalDispatchSecret,
    {
      provide: JobQueue,
      inject: [ConfigService, LocalDispatchSecret, HttpAdapterHost],
      useFactory: (
        config: ConfigService<Env, true>,
        secret: LocalDispatchSecret,
        httpAdapterHost: HttpAdapterHost,
      ) => createJobQueue(config.get('JOB_QUEUE', { infer: true }), secret, httpAdapterHost),
    },
  ],
  exports: [StorageService, LlmProvider, TtsProvider, JobQueue, LocalDispatchSecret],
})
export class ProvidersModule {}
