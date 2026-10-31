import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { findEligible } from './queue-candidates';

// The finders with their narrowing options (findEligible) against the real local database.
// The defaults of the finders are covered by the top-up specs; this file covers what the
// explicit options let through and, above all, what they can never let through (SECURITY.md
// rule 10). The list and the routes are covered in topics.int-spec.ts and
// queue-pick.int-spec.ts.
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

async function world() {
  const voiceId = await data.voice();
  const otherVoiceId = await data.voice();
  const interestId = await data.interest();
  const otherInterestId = await data.interest();
  const userId = await data.user({ voiceId, interestIds: [interestId] });
  const strangerId = await data.user({ voiceId, interestIds: [interestId] });
  return { voiceId, otherVoiceId, interestId, otherInterestId, userId, strangerId };
}
type World = Awaited<ReturnType<typeof world>>;

const eligible = (w: World, topicIds: string[], extra: { includeQueued?: boolean; includeFailed?: boolean } = {}) =>
  findEligible(prisma, { userId: w.userId, voiceId: w.voiceId, topicIds, ...extra });

describe('findEligible', () => {
  it('accepts ready, no-audio and own no-story topics, and nothing for an empty list', async () => {
    const w = await world();
    const ready = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    const noAudio = await data.topic({ interestId: w.interestId, story: true });
    const own = await data.topic({ interestId: w.interestId });
    await data.userTopic(w.userId, own.topicId, 'proposed');
    const ids = [ready.topicId, noAudio.topicId, own.topicId];
    expect(await eligible(w, ids)).toEqual(new Set(ids));
    expect(await eligible(w, [])).toEqual(new Set());
  });

  it('treats a random id, another person\'s typed topic and a NULL-interest pool topic alike: not eligible', async () => {
    const w = await world();
    const typed = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await data.userTopic(w.strangerId, typed.topicId, 'requested');
    const nullInterest = await data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
    await data.userTopic(w.strangerId, nullInterest.topicId, 'proposed');
    const ok = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    const options = { includeQueued: true, includeFailed: true };
    const result = await eligible(
      w,
      [typed.topicId, nullInterest.topicId, ok.topicId, '00000000-0000-4000-8000-00000000dead'],
      options,
    );
    expect(result).toEqual(new Set([ok.topicId]));
  });

  it('lets the author see their own NULL-interest proposed topic, and nobody else', async () => {
    const w = await world();
    const mine = await data.topic({ interestId: null });
    await data.userTopic(w.userId, mine.topicId, 'proposed');
    expect(await eligible(w, [mine.topicId])).toEqual(new Set([mine.topicId]));
    const asStranger = await findEligible(prisma, {
      userId: w.strangerId,
      voiceId: w.voiceId,
      topicIds: [mine.topicId],
    });
    expect(asStranger).toEqual(new Set());
  });

  it('never lets through heard, dismissed, rated -1 or out-of-style topics, whatever the options', async () => {
    const w = await world();
    const heard = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await data.listen(w.userId, heard.storyId as string, w.voiceId);
    const disliked = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await data.rating(w.userId, disliked.storyId as string, -1);
    const dismissed = await data.topic({ interestId: w.interestId });
    await data.userTopic(w.userId, dismissed.topicId, 'proposed', { dismissed: true });
    const otherStyle = await data.topic({ interestId: w.interestId, style: 'history', story: true });
    const otherInterest = await data.topic({ interestId: w.otherInterestId, story: true });
    const ids = [heard, disliked, dismissed, otherStyle, otherInterest].map((t) => t.topicId);
    expect(await eligible(w, ids, { includeQueued: true, includeFailed: true })).toEqual(new Set());
  });

  it('excludes queued and finally failed topics by default and lets them through on request', async () => {
    const w = await world();
    const queued = await data.topic({ interestId: w.interestId, story: true });
    await data.queueItem(w.userId, queued.topicId, 1);
    const failedWrite = await data.topic({ interestId: w.interestId });
    await data.userTopic(w.userId, failedWrite.topicId, 'proposed');
    await data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${failedWrite.topicId}`,
    });
    const failedRender = await data.topic({ interestId: w.interestId, story: true });
    await data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'failed',
      dedupeKey: `render_audio:${failedRender.storyId}:${w.voiceId}`,
    });
    const ids = [queued.topicId, failedWrite.topicId, failedRender.topicId];
    expect(await eligible(w, ids)).toEqual(new Set());
    expect(await eligible(w, ids, { includeQueued: true })).toEqual(new Set([queued.topicId]));
    expect(await eligible(w, ids, { includeFailed: true })).toEqual(
      new Set([failedWrite.topicId, failedRender.topicId]),
    );
  });
});
