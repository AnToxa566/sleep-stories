import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StoryStyleSchema } from '@sleep-stories/contracts';
import { AppModule } from '../app.module';
import { isLoopbackDatabaseUrl } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { TtsProviderError } from '../providers/tts/tts.provider';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { AudioRendererService } from './audio-renderer.service';
import { StoryWriterService } from './story-writer.service';

// PAID smoke test: one real Anthropic call and one real ElevenLabs call, then a real
// upload to the LOCAL Supabase Storage. It is skipped unless RUN_PAID_SMOKE=1, so the
// normal `test-integration` run never spends money. With the flag, the real keys come
// from apps/api/.env (see test-support/fake-service-role-key.ts).
//
// It prints with console.log only: character count, duration, byte size, model ids,
// prompt version and the signed URL. Never the story text, a key or an .env value.
// The object lives at stories/<random uuid>/<voice id>.mp3 and is left in the local
// bucket on purpose: it cannot collide with a real story.
//
// Environment (all optional): SMOKE_VOICE (seeded voice slug, default 'anna'),
// SMOKE_STYLE (facts | fairy_tale | history, default 'fairy_tale'), SMOKE_TOPIC.
assertLocalDatabase();
// The real service-role key is used under RUN_PAID_SMOKE=1, so a half-switched .env (local
// database, cloud SUPABASE_URL) would upload the audio to cloud Storage. The message is
// fixed and does not print the URL. isLoopbackDatabaseUrl only inspects scheme-agnostic
// host rules, so it works for an http:// URL too.
if (process.env['RUN_PAID_SMOKE'] === '1' && !isLoopbackDatabaseUrl(process.env['SUPABASE_URL'] ?? '')) {
  throw new Error('The paid smoke test requires SUPABASE_URL to be a loopback address (local Supabase stack)');
}

const enabled = process.env['RUN_PAID_SMOKE'] === '1';
const SLUG = process.env['SMOKE_VOICE'] ?? 'anna';
const STYLE = StoryStyleSchema.parse(process.env['SMOKE_STYLE'] ?? 'fairy_tale');
const TOPIC = process.env['SMOKE_TOPIC'] ?? 'Ночной маяк на берегу тихого моря';
const SIGNED_URL_SECONDS = 10 * 60;

(enabled ? describe : describe.skip)('generation smoke (paid, RUN_PAID_SMOKE=1)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.createNestApplication().init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it(
    'writes one story, renders it, uploads it and signs a URL',
    async () => {
      const voice = await app
        .get(PrismaService)
        .voice.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true, providerVoiceId: true } });

      const story = await app.get(StoryWriterService).write({ style: STYLE, topicTitle: TOPIC });
      const storyId = randomUUID();
      // The adapter errors have fixed messages on purpose (the provider's text can embed
      // a response body). The numeric status is not sensitive, so the smoke test prints
      // it: it is the only way to tell a wrong model id (400/422) from a bad key (401)
      // or an exhausted quota (402/429) without the provider's own text.
      const audio = await app
        .get(AudioRendererService)
        .render({
          storyId,
          voice: { id: voice.id, providerVoiceId: voice.providerVoiceId },
          text: story.text,
        })
        .catch((error: unknown) => {
          if (error instanceof TtsProviderError) {
            console.log(`TTS failed: status ${error.status ?? 'none'}, retryable ${error.retryable}`);
          }
          throw error;
        });
      const [signedUrl] = await app
        .get(StorageService)
        .signMany([audio.storagePath], SIGNED_URL_SECONDS);

      console.log(
        [
          `voice: ${SLUG}, style: ${STYLE}`,
          `characters: ${story.text.length}`,
          `durationSec: ${audio.durationSec}`,
          `byteSize: ${audio.byteSize}`,
          `llmModel: ${story.model}`,
          `ttsProvider: ${audio.ttsProvider}`,
          `promptVersion: ${story.promptVersion}`,
          `signedUrl (10 minutes): ${signedUrl}`,
        ].join('\n'),
      );
      expect(audio.durationSec).toBeGreaterThan(0);
    },
    180_000,
  );
});
