import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { QueueResponseSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../auth/access-token-verifier';
import { AppModule } from '../app.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { StorageService } from '../providers/storage/storage.service';

// POST /api/queue/rebuild against the REAL local database and the real AppModule: unheard
// stories replace the whole queue, a heard story is not picked, another person's typed topic
// never appears, nothing unheard leaves an empty queue and at most a topic suggestion (never a
// story or audio job), and one person's call leaves another person's queue alone.
assertLocalDatabase();

const KID = 'int-test-key';

// A recording fake: the real queue (JOB_QUEUE=local) would run a suggestion job with the paid
// providers. It also lets a test see what was enqueued.
class RecordingQueue extends JobQueue {
  enqueued: string[] = [];
  async enqueue(jobId: string): Promise<void> {
    this.enqueued.push(jobId);
  }
}
const jobQueue = new RecordingQueue();

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let baseUrl: string;
let issuer: string;
let signingKey: CryptoKey;

async function call(userId?: string) {
  const headers: Record<string, string> = {};
  if (userId !== undefined) {
    headers['authorization'] = `Bearer ${await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(signingKey)}`;
  }
  const response = await fetch(`${baseUrl}/api/queue/rebuild`, { method: 'POST', headers });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as unknown };
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }],
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => {
        issuer = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    })
    .overrideProvider(StorageService)
    .useValue({
      signMany: async (paths: readonly string[]) =>
        paths.map((_path, index) => `https://signed.example.test/opaque-${index}?token=fake`),
    })
    .overrideProvider(JobQueue)
    .useValue(jobQueue)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useLogger(false);
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
  data = new QueueTestData(prisma);
});

beforeEach(() => {
  jobQueue.enqueued = [];
});

afterAll(async () => {
  await data?.cleanup();
  await app?.close();
});

async function world() {
  const voiceId = await data.voice();
  const interestId = await data.interest();
  const userId = await data.user({ voiceId, interestIds: [interestId] });
  const strangerId = await data.user({ voiceId, interestIds: [interestId] });
  return { voiceId, interestId, userId, strangerId };
}
type World = Awaited<ReturnType<typeof world>>;

// A ready topic (story and audio in the person's voice). `age` orders `newest`: a bigger
// number is older, so the topics have distinct creation times.
async function readyTopic(w: World, age = 0) {
  const topic = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
  await prisma.topic.update({
    where: { id: topic.topicId },
    data: { createdAt: new Date(Date.now() - age * 60_000) },
  });
  return topic as { topicId: string; storyId: string };
}

async function itemRows(userId: string) {
  return prisma.queueItem.findMany({
    where: { userId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true, topicId: true },
  });
}
const jobsOf = (userId: string) =>
  prisma.generationJob.findMany({
    where: { requestedByUserId: userId },
    select: { id: true, kind: true, status: true },
  });

describe('POST /api/queue/rebuild', () => {
  it('requires a token', async () => {
    expect((await call()).status).toBe(401);
  });

  it('replaces the whole queue with unheard ready stories, newest first, and creates no job', async () => {
    const w = await world();
    await readyTopic(w, 40);
    const older = await readyTopic(w, 30);
    const newer = await readyTopic(w, 20);
    const newest = await readyTopic(w, 10);
    const old = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.userId, old.topicId, 1);

    const result = await call(w.userId);
    expect(result.status).toBe(200);
    const body = QueueResponseSchema.parse(result.json);
    expect(body.items.map((item) => item.topicId)).toEqual([
      newest.topicId,
      newer.topicId,
      older.topicId,
    ]);
    expect(body.items.every((item) => item.state === 'ready')).toBe(true);
    expect((await itemRows(w.userId)).map((row) => [row.topicId, row.position])).toEqual([
      [newest.topicId, 1],
      [newer.topicId, 2],
      [older.topicId, 3],
    ]);
    expect(await jobsOf(w.userId)).toEqual([]);
    expect(jobQueue.enqueued).toEqual([]);
  });

  it('does not pick a heard story, even when it is in the queue, and fills the rest after the ready ones', async () => {
    const w = await world();
    const heard = await readyTopic(w, 10);
    const fresh = await readyTopic(w, 20);
    await data.listen(w.userId, heard.storyId, w.voiceId);
    await data.queueItem(w.userId, heard.topicId, 1);
    const noAudio = await data.topic({ interestId: w.interestId, story: true });
    const own = await data.topic({ interestId: null });
    await data.userTopic(w.userId, own.topicId, 'proposed');

    const body = QueueResponseSchema.parse((await call(w.userId)).json);
    expect(body.items.map((item) => item.topicId)).toEqual([fresh.topicId, noAudio.topicId, own.topicId]);
    expect((await itemRows(w.userId)).map((row) => row.topicId)).not.toContain(heard.topicId);
    // Three found: no top-up, no job.
    expect(await jobsOf(w.userId)).toEqual([]);
  });

  it('a story heard only partly (under 90 %) is still picked', async () => {
    const w = await world();
    const topic = await readyTopic(w);
    await data.listen(w.userId, topic.storyId, w.voiceId, 30);
    const body = QueueResponseSchema.parse((await call(w.userId)).json);
    expect(body.items.map((item) => item.topicId)).toEqual([topic.topicId]);
  });

  it('never picks a story of another person\'s typed topic', async () => {
    const w = await world();
    const typed = await readyTopic(w, 5);
    await data.userTopic(w.strangerId, typed.topicId, 'requested');
    const allowed = await readyTopic(w, 20);

    const result = await call(w.userId);
    const body = QueueResponseSchema.parse(result.json);
    expect(body.items.map((item) => item.topicId)).toEqual([allowed.topicId]);
    expect(result.text).not.toContain(typed.topicId);
    expect((await itemRows(w.userId)).map((row) => row.topicId)).not.toContain(typed.topicId);
  });

  it('with nothing unheard empties the queue, creates only suggest_topics and reports collecting', async () => {
    const w = await world();
    const heard = await readyTopic(w, 10);
    await data.listen(w.userId, heard.storyId, w.voiceId);
    const old = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await data.listen(w.userId, old.storyId as string, w.voiceId);
    await data.queueItem(w.userId, heard.topicId, 1);

    const result = await call(w.userId);
    expect(result.status).toBe(200);
    const body = QueueResponseSchema.parse(result.json);
    expect(body.items).toEqual([]);
    expect(body.collecting).toBe(true);
    expect(await itemRows(w.userId)).toEqual([]);
    const jobs = await jobsOf(w.userId);
    expect(jobs.map((job) => job.kind)).toEqual(['suggest_topics']);
    expect(jobs.filter((job) => job.kind === 'write_story' || job.kind === 'render_audio')).toEqual([]);
    expect(jobQueue.enqueued).toEqual([jobs[0]?.id]);
  });

  it('with fewer than three found keeps them and asks only for the missing topics', async () => {
    const w = await world();
    const one = await readyTopic(w);

    const body = QueueResponseSchema.parse((await call(w.userId)).json);
    expect(body.items.map((item) => item.topicId)).toEqual([one.topicId]);
    const jobs = await jobsOf(w.userId);
    expect(jobs.map((job) => job.kind)).toEqual(['suggest_topics']);
  });

  it('with the suggestion cap used up leaves an empty queue and no new job', async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) {
      await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 1 });
    }
    const body = QueueResponseSchema.parse((await call(w.userId)).json);
    expect(body.items).toEqual([]);
    expect(body.collecting).toBe(false);
    expect(await jobsOf(w.userId)).toHaveLength(5);
    expect(jobQueue.enqueued).toEqual([]);
  });

  it('leaves another person\'s queue and listens untouched', async () => {
    const w = await world();
    await readyTopic(w, 10);
    const theirs = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.strangerId, theirs.topicId, 1);
    const before = await itemRows(w.strangerId);

    expect((await call(w.userId)).status).toBe(200);
    expect(await itemRows(w.strangerId)).toEqual(before);
    expect(await jobsOf(w.strangerId)).toEqual([]);
  });

  it('counts only the caller\'s listens: a story the stranger heard is still picked', async () => {
    const w = await world();
    const topic = await readyTopic(w);
    await data.listen(w.strangerId, topic.storyId, w.voiceId);
    const body = QueueResponseSchema.parse((await call(w.userId)).json);
    expect(body.items.map((item) => item.topicId)).toEqual([topic.topicId]);
  });

  it('answers an empty queue and writes nothing for a person who has not finished onboarding', async () => {
    const userId = await data.user();
    const body = QueueResponseSchema.parse((await call(userId)).json);
    expect(body.items).toEqual([]);
    expect(await jobsOf(userId)).toEqual([]);
  });
});
