import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { removeWaitingItems } from './queue-waiters';

// Runs against the REAL local database with the real PrismaModule. Every test builds its
// own voices, people and topics with random ids.
assertLocalDatabase();

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  data = new QueueTestData(prisma);
});

afterAll(async () => {
  await data.cleanup();
  await app.close();
});

const topicsOf = async (userId: string) =>
  (await prisma.queueItem.findMany({ where: { userId }, select: { topicId: true } })).map(
    (i) => i.topicId,
  );

const inTransaction = (fn: (tx: Parameters<typeof removeWaitingItems>[0]) => Promise<void>) =>
  prisma.$transaction(fn);

async function world() {
  const voiceId = await data.voice();
  const otherVoiceId = await data.voice();
  const target = await data.topic({ story: true });
  const unrelated = await data.topic({ story: true });
  const sameVoice = await data.user({ voiceId });
  const sameVoiceToo = await data.user({ voiceId });
  const otherVoice = await data.user({ voiceId: otherVoiceId });
  const noPreferences = await data.user();
  for (const userId of [sameVoice, sameVoiceToo, otherVoice, noPreferences]) {
    await data.queueItem(userId, target.topicId, 1);
  }
  await data.queueItem(sameVoice, unrelated.topicId, 2);
  return { voiceId, target, unrelated, sameVoice, sameVoiceToo, otherVoice, noPreferences };
}

describe('removeWaitingItems', () => {
  it('write_story removes the topic item of every person, whatever their voice, and nothing else', async () => {
    const w = await world();
    await inTransaction((tx) =>
      removeWaitingItems(tx, { kind: 'write_story', topicId: w.target.topicId, voiceId: w.voiceId }),
    );
    expect(await topicsOf(w.sameVoice)).toEqual([w.unrelated.topicId]);
    expect(await topicsOf(w.sameVoiceToo)).toEqual([]);
    expect(await topicsOf(w.otherVoice)).toEqual([]);
    expect(await topicsOf(w.noPreferences)).toEqual([]);
  });

  it('render_audio removes the story topic item of the people with that voice only', async () => {
    const w = await world();
    await inTransaction((tx) =>
      removeWaitingItems(tx, {
        kind: 'render_audio',
        storyId: w.target.storyId as string,
        voiceId: w.voiceId,
      }),
    );
    expect(await topicsOf(w.sameVoice)).toEqual([w.unrelated.topicId]);
    expect(await topicsOf(w.sameVoiceToo)).toEqual([]);
    // Another voice has its own render key; no preferences means not waiting on this one.
    expect(await topicsOf(w.otherVoice)).toEqual([w.target.topicId]);
    expect(await topicsOf(w.noPreferences)).toEqual([w.target.topicId]);
  });

  it('render_audio for an unknown story deletes nothing', async () => {
    const w = await world();
    await inTransaction((tx) =>
      removeWaitingItems(tx, {
        kind: 'render_audio',
        storyId: '00000000-0000-4000-8000-000000000000',
        voiceId: w.voiceId,
      }),
    );
    expect(await topicsOf(w.sameVoice)).toHaveLength(2);
    expect(await topicsOf(w.otherVoice)).toEqual([w.target.topicId]);
  });

  it('suggest_topics deletes nothing', async () => {
    const w = await world();
    await inTransaction((tx) => removeWaitingItems(tx, { kind: 'suggest_topics', missing: 1 }));
    expect(await topicsOf(w.sameVoice)).toHaveLength(2);
    expect(await topicsOf(w.sameVoiceToo)).toEqual([w.target.topicId]);
    expect(await topicsOf(w.otherVoice)).toEqual([w.target.topicId]);
    expect(await topicsOf(w.noPreferences)).toEqual([w.target.topicId]);
  });
});
