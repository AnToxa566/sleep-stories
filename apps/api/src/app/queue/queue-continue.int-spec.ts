import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ContinueResponseSchema } from '@sleep-stories/contracts';
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

// POST /api/queue/continue against the REAL local database and the real AppModule. The cases of
// cycle A step 4: the found stories replace the queue, a heard story is not offered, nothing
// ready creates no story or audio job (at most a topic suggestion), another person's typed
// topic never appears, and one person's call leaves another person's queue alone.
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
  const response = await fetch(`${baseUrl}/api/queue/continue`, { method: 'POST', headers });
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

describe('POST /api/queue/continue', () => {
  it('requires a token', async () => {
    expect((await call()).status).toBe(401);
  });

  it('(a) replaces the queue with the ready, unheard stories, newest first, and creates no job', async () => {
    const w = await world();
    const oldest = await readyTopic(w, 40);
    const older = await readyTopic(w, 30);
    const newer = await readyTopic(w, 20);
    const newest = await readyTopic(w, 10);
    const notReady = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.userId, notReady.topicId, 1);

    const result = await call(w.userId);
    expect(result.status).toBe(200);
    const body = ContinueResponseSchema.parse(result.json);
    expect(body.outcome).toBe('ready');
    // The queue target is three: the three newest, the first one is the newest.
    expect(body.queue.items.map((item) => item.topicId)).toEqual([
      newest.topicId,
      newer.topicId,
      older.topicId,
    ]);
    expect(body.queue.items.every((item) => item.state === 'ready')).toBe(true);
    expect(body.queue.items.every((item) => item.state === 'ready' && item.audioUrl.length > 0)).toBe(true);
    // The old, not ready item is gone: replaced, not kept.
    const rows = await itemRows(w.userId);
    expect(rows.map((row) => [row.topicId, row.position])).toEqual([
      [newest.topicId, 1],
      [newer.topicId, 2],
      [older.topicId, 3],
    ]);
    expect(rows.some((row) => row.topicId === notReady.topicId || row.topicId === oldest.topicId)).toBe(false);
    expect(await jobsOf(w.userId)).toEqual([]);
    expect(jobQueue.enqueued).toEqual([]);
  });

  it('(a) keeps a ready story that is queued already and drops no one twice', async () => {
    const w = await world();
    const only = await readyTopic(w);
    await data.queueItem(w.userId, only.topicId, 1);
    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.outcome).toBe('ready');
    expect(body.queue.items.map((item) => item.topicId)).toEqual([only.topicId]);
    expect(await itemRows(w.userId)).toHaveLength(1);
  });

  it('(b) does not offer a story the person has heard, even when it is in the queue', async () => {
    const w = await world();
    const heard = await readyTopic(w, 10);
    const fresh = await readyTopic(w, 20);
    await data.listen(w.userId, heard.storyId, w.voiceId);
    await data.queueItem(w.userId, heard.topicId, 1);

    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.outcome).toBe('ready');
    expect(body.queue.items.map((item) => item.topicId)).toEqual([fresh.topicId]);
    expect((await itemRows(w.userId)).map((row) => row.topicId)).toEqual([fresh.topicId]);
  });

  it('(c) with every ready story heard answers none_ready and creates only suggest_topics', async () => {
    const w = await world();
    for (const age of [10, 20]) {
      const topic = await readyTopic(w, age);
      await data.listen(w.userId, topic.storyId, w.voiceId);
    }
    const result = await call(w.userId);
    expect(result.status).toBe(200);
    const body = ContinueResponseSchema.parse(result.json);
    expect(body.outcome).toBe('none_ready');
    expect(body.queue.items).toEqual([]);
    expect(body.queue.collecting).toBe(true);

    const jobs = await jobsOf(w.userId);
    expect(jobs.map((job) => job.kind)).toEqual(['suggest_topics']);
    expect(jobQueue.enqueued).toEqual([jobs[0].id]);
    // No story or audio job exists for this person, and none was enqueued for anybody.
    expect(jobs.filter((job) => job.kind === 'write_story' || job.kind === 'render_audio')).toEqual([]);
  });

  it('(c) keeps what the queue holds when nothing is ready and the suggestion cap is used up', async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) {
      await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 1 });
    }
    const queued = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.userId, queued.topicId, 1);
    const before = await itemRows(w.userId);

    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.outcome).toBe('none_ready');
    expect(body.queue.items.map((item) => item.topicId)).toEqual([queued.topicId]);
    expect(await itemRows(w.userId)).toEqual(before);
    const jobs = await jobsOf(w.userId);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.kind === 'suggest_topics')).toBe(true);
    expect(jobQueue.enqueued).toEqual([]);
  });

  it('(c) keeps queued items and fills the rest from the pool without a story or audio job', async () => {
    const w = await world();
    const queued = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.userId, queued.topicId, 1);
    // A story without audio in the person's voice: not ready, so not a continue candidate,
    // but the top-up may queue it.
    const noAudio = await data.topic({ interestId: w.interestId, story: true });

    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.outcome).toBe('none_ready');
    const ids = body.queue.items.map((item) => item.topicId);
    expect(ids[0]).toBe(queued.topicId);
    expect(ids).toContain(noAudio.topicId);
    const jobs = await jobsOf(w.userId);
    expect(jobs.every((job) => job.kind === 'suggest_topics')).toBe(true);
  });

  it('(d) never offers a story of another person\'s typed topic', async () => {
    const w = await world();
    const typed = await readyTopic(w, 5);
    await data.userTopic(w.strangerId, typed.topicId, 'requested');
    const allowed = await readyTopic(w, 20);

    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.outcome).toBe('ready');
    expect(body.queue.items.map((item) => item.topicId)).toEqual([allowed.topicId]);
    expect((await itemRows(w.userId)).map((row) => row.topicId)).not.toContain(typed.topicId);
  });

  it('(d) with a typed topic as the only story answers none_ready and shows nothing of it', async () => {
    const w = await world();
    const typed = await readyTopic(w);
    await data.userTopic(w.strangerId, typed.topicId, 'requested');

    const result = await call(w.userId);
    const body = ContinueResponseSchema.parse(result.json);
    expect(body.outcome).toBe('none_ready');
    expect(body.queue.items).toEqual([]);
    expect(result.text).not.toContain(typed.topicId);
    expect(await itemRows(w.userId)).toEqual([]);
  });

  it('(e) leaves another person\'s queue untouched', async () => {
    const w = await world();
    await readyTopic(w, 10);
    const theirs = await data.topic({ interestId: w.interestId });
    await data.queueItem(w.strangerId, theirs.topicId, 1);
    const before = await itemRows(w.strangerId);

    expect(ContinueResponseSchema.parse((await call(w.userId)).json).outcome).toBe('ready');
    expect(await itemRows(w.strangerId)).toEqual(before);
    expect(await jobsOf(w.strangerId)).toEqual([]);
  });

  it('(e) counts only the caller\'s listens: a story the stranger heard is still offered', async () => {
    const w = await world();
    const topic = await readyTopic(w);
    await data.listen(w.strangerId, topic.storyId, w.voiceId);

    const body = ContinueResponseSchema.parse((await call(w.userId)).json);
    expect(body.queue.items.map((item) => item.topicId)).toEqual([topic.topicId]);
  });

  it('answers none_ready and writes nothing for a person who has not finished onboarding', async () => {
    const userId = await data.user();
    const body = ContinueResponseSchema.parse((await call(userId)).json);
    expect(body.outcome).toBe('none_ready');
    expect(body.queue.items).toEqual([]);
    expect(await jobsOf(userId)).toEqual([]);
  });
});
