import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, QueueResponseSchema } from '@sleep-stories/contracts';
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

// The explicit generation start (POST /queue/generate and /queue/items/:itemId/generate),
// against the REAL local database with the real AppModule. The JobQueue is a recording fake
// that dispatches nothing (and can be switched to throw), so a created job stays `pending` and
// nothing can reach a provider. Each test builds its own people and topics with random ids.
assertLocalDatabase();

const KID = 'int-test-key';
const LIMIT_BODY = { statusCode: 429, code: 'generation_limit_reached', message: 'Generation limit reached' };
const NOT_FOUND_BODY = { statusCode: 404, code: 'queue_item_not_found', message: 'Queue item not found' };

class RecordingQueue extends JobQueue {
  enqueued: string[] = [];
  failing = false;
  async enqueue(jobId: string): Promise<void> {
    if (this.failing) {
      throw new Error('queue down');
    }
    this.enqueued.push(jobId);
  }
}

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let baseUrl: string;
let issuer: string;
let signingKey: CryptoKey;
const queue = new RecordingQueue();
const signMany = jest.fn<Promise<string[]>, [readonly string[], number]>();

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
}

type Reply = { status: number; text: string; json: unknown };
async function call(method: string, path: string, userId?: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (userId !== undefined) headers['authorization'] = `Bearer ${await tokenFor(userId)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as unknown };
}
const generateAll = (userId?: string) => call('POST', '/queue/generate', userId);
const generateOne = (userId: string | undefined, itemId: string) =>
  call('POST', `/queue/items/${itemId}/generate`, userId);
const parseQueue = (reply: Reply) => QueueResponseSchema.parse(reply.json);

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
    .useValue({ signMany })
    .overrideProvider(JobQueue)
    .useValue(queue)
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
  queue.enqueued = [];
  queue.failing = false;
  signMany.mockReset();
  signMany.mockImplementation(async (paths) => paths.map((_p, i) => `https://signed.example.test/opaque-${i}`));
});

afterAll(async () => {
  await data?.cleanup();
  await app?.close();
});

async function world() {
  const voiceId = await data.voice();
  const userId = await data.user({ voiceId });
  return { voiceId, userId };
}

// A queue of `count` topics with no story (not_ready); returns the item ids and topic ids.
async function notReadyQueue(userId: string, count: number) {
  const items: { itemId: string; topicId: string }[] = [];
  for (let position = 1; position <= count; position++) {
    const topic = await data.topic();
    await data.queueItem(userId, topic.topicId, position);
    const row = await prisma.queueItem.findFirstOrThrow({
      where: { userId, topicId: topic.topicId },
      select: { id: true },
    });
    items.push({ itemId: row.id, topicId: topic.topicId });
  }
  return items;
}

// Uses up `count` generations of the window with succeeded renders of an hour ago.
async function spend(userId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await data.job({ userId, kind: 'render_audio', status: 'succeeded', hoursAgo: 1 });
  }
}

const storyJobs = (userId: string) =>
  prisma.generationJob.findMany({
    where: { requestedByUserId: userId, kind: { in: ['write_story', 'render_audio'] } },
    select: { id: true, kind: true, status: true, dedupeKey: true, payload: true },
  });
const storyJobCount = async (userId: string) => (await storyJobs(userId)).length;

// Runs `fire` while another transaction holds the person's `users` row lock, as
// requestWhileLockHeld in queue.int-spec.ts does, but lets the test change the person's rows
// (`whileHeld`) before the lock is released. The request is seen waiting on the lock first;
// a route that does not take the lock never waits and fails here.
async function requestWhileLockHeld(
  userId: string,
  fire: () => Promise<Reply>,
  whileHeld: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<void>,
): Promise<Reply> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      locked();
      await gate;
      await whileHeld(tx);
    },
    { timeout: 30_000 },
  );
  let pending: Promise<Reply> | undefined;
  let waitingSeen = false;
  try {
    await lockTaken;
    pending = fire();
    for (let attempt = 0; attempt < 100 && !waitingSeen; attempt++) {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND query ILIKE '%FROM users%FOR UPDATE%'
          AND pid <> pg_backend_pid()
      `;
      waitingSeen = rows[0].n > 0;
      if (!waitingSeen) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    release();
    await holder;
  }
  if (!waitingSeen) {
    await pending;
    throw new Error('The request was never seen waiting on the users-row lock: it did not take it');
  }
  return pending as Promise<Reply>;
}

describe('authentication', () => {
  it('answers 401 without a token on both routes', async () => {
    for (const reply of [await generateAll(), await generateOne(undefined, randomUUID())]) {
      expect(reply.status).toBe(401);
      expect(ApiErrorResponseSchema.parse(reply.json)).toMatchObject({ statusCode: 401, code: 'unauthorized' });
    }
  });
});

describe('nothing else creates a story job', () => {
  it('GET /queue, DELETE, PUT order and onboarding create no write_story or render_audio row', async () => {
    const w = await world();
    const items = await notReadyQueue(w.userId, 3);

    expect((await call('GET', '/queue', w.userId)).status).toBe(200);
    expect((await call('DELETE', `/queue/items/${items[0].itemId}`, w.userId)).status).toBe(200);
    const order = [items[2].itemId, items[1].itemId];
    expect((await call('PUT', '/queue/order', w.userId, { itemIds: order })).status).toBe(200);

    // A fresh person completes onboarding through the real endpoint.
    const interestId = await data.interest();
    const interest = await prisma.interest.findUniqueOrThrow({ where: { id: interestId } });
    const voice = await prisma.voice.findUniqueOrThrow({ where: { id: w.voiceId } });
    const fresh = await data.user();
    const onboarding = await call('PUT', '/me/onboarding', fresh, {
      voiceSlug: voice.slug,
      styles: ['facts'],
      interestSlugs: [interest.slug],
    });
    expect(onboarding.status).toBe(200);

    expect(await storyJobCount(w.userId)).toBe(0);
    expect(await storyJobCount(fresh)).toBe(0);
  });
});

describe('POST /api/queue/items/:itemId/generate', () => {
  it('creates exactly one job and lowers generations.left by one', async () => {
    const w = await world();
    const items = await notReadyQueue(w.userId, 2);

    const reply = await generateOne(w.userId, items[0].itemId);

    expect(reply.status).toBe(200);
    const body = parseQueue(reply);
    expect(body.generations).toEqual({ left: 4, limit: 5 });
    expect(body.items.find((item) => item.id === items[0].itemId)?.state).toBe('creating');
    expect(body.items.find((item) => item.id === items[1].itemId)?.state).toBe('not_ready');
    const jobs = await storyJobs(w.userId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'write_story',
      status: 'pending',
      dedupeKey: `write_story:${items[0].topicId}`,
      payload: { kind: 'write_story', topicId: items[0].topicId, voiceId: w.voiceId },
    });
    expect(queue.enqueued).toEqual([jobs[0].id]);
  });

  it('is a no-op the second time (sequential double tap): two 200s and one job', async () => {
    const w = await world();
    const [item] = await notReadyQueue(w.userId, 1);

    const first = await generateOne(w.userId, item.itemId);
    const second = await generateOne(w.userId, item.itemId);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(parseQueue(second).generations.left).toBe(4);
    expect(await storyJobCount(w.userId)).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it.each([
    ['ready', false],
    ['ready', true],
    ['creating', false],
    ['creating', true],
  ])('answers 200 and creates nothing for a %s item (generations exhausted: %s)', async (kind, exhausted) => {
    const w = await world();
    const topic =
      kind === 'ready' ? await data.topic({ story: true, audioVoiceIds: [w.voiceId] }) : await data.topic();
    await data.queueItem(w.userId, topic.topicId, 1);
    const row = await prisma.queueItem.findFirstOrThrow({ where: { userId: w.userId } });
    if (kind === 'creating') {
      const other = await data.user({ voiceId: w.voiceId });
      await data.job({
        userId: other,
        kind: 'write_story',
        status: 'running',
        dedupeKey: `write_story:${topic.topicId}`,
      });
    }
    if (exhausted) {
      await spend(w.userId, 5);
    }
    const before = await storyJobCount(w.userId);

    const reply = await generateOne(w.userId, row.id);

    expect(reply.status).toBe(200);
    expect(await storyJobCount(w.userId)).toBe(before);
    expect(queue.enqueued).toEqual([]);
  });

  it('starts a new write_story for a failed write_story', async () => {
    const w = await world();
    const [item] = await notReadyQueue(w.userId, 1);
    await data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${item.topicId}`,
    });

    const reply = await generateOne(w.userId, item.itemId);

    expect(reply.status).toBe(200);
    const active = (await storyJobs(w.userId)).filter((job) => job.status === 'pending');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: 'write_story', dedupeKey: `write_story:${item.topicId}` });
    expect(parseQueue(reply).generations.left).toBe(4);
  });

  it('starts a render_audio for a failed render of an existing story (no second write)', async () => {
    const w = await world();
    const topic = await data.topic({ story: true });
    await data.queueItem(w.userId, topic.topicId, 1);
    const row = await prisma.queueItem.findFirstOrThrow({ where: { userId: w.userId } });
    const key = `render_audio:${topic.storyId}:${w.voiceId}`;
    await data.job({ userId: w.userId, kind: 'render_audio', status: 'failed', dedupeKey: key });

    const reply = await generateOne(w.userId, row.id);

    expect(reply.status).toBe(200);
    const active = (await storyJobs(w.userId)).filter((job) => job.status === 'pending');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      kind: 'render_audio',
      dedupeKey: key,
      payload: { kind: 'render_audio', storyId: topic.storyId, voiceId: w.voiceId },
    });
  });

  it('answers a byte-identical 404 for a foreign item and a missing item, and writes nothing', async () => {
    const w = await world();
    const stranger = await world();
    const [foreign] = await notReadyQueue(stranger.userId, 1);

    const foreignReply = await generateOne(w.userId, foreign.itemId);
    const missingReply = await generateOne(w.userId, randomUUID());

    expect(foreignReply.status).toBe(404);
    expect(missingReply.status).toBe(404);
    expect(foreignReply.json).toEqual(NOT_FOUND_BODY);
    expect(foreignReply.text).toBe(missingReply.text);
    expect(await storyJobCount(stranger.userId)).toBe(0);
    expect(await storyJobCount(w.userId)).toBe(0);
  });

  it('answers 400 validation_failed for a malformed id', async () => {
    const w = await world();
    const reply = await call('POST', '/queue/items/not-a-uuid/generate', w.userId);
    expect(reply.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(reply.json).code).toBe('validation_failed');
  });

  it('answers 400 when onboarding is not finished', async () => {
    const userId = await data.user();
    const topic = await data.topic();
    await data.queueItem(userId, topic.topicId, 1);
    const row = await prisma.queueItem.findFirstOrThrow({ where: { userId } });

    for (const reply of [await generateOne(userId, row.id), await generateAll(userId)]) {
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual({
        statusCode: 400,
        code: 'validation_failed',
        message: 'Onboarding is not finished',
      });
    }
    expect(await storyJobCount(userId)).toBe(0);
  });

  it('refuses a single start at zero left with the exact 429 body and no row', async () => {
    const w = await world();
    const [item] = await notReadyQueue(w.userId, 1);
    await spend(w.userId, 5);

    const reply = await generateOne(w.userId, item.itemId);

    expect(reply.status).toBe(429);
    expect(reply.json).toEqual(LIMIT_BODY);
    expect((await storyJobs(w.userId)).filter((job) => job.status === 'pending')).toHaveLength(0);
  });

  it('still answers 200 and leaves the row pending when the enqueue throws', async () => {
    const w = await world();
    const [item] = await notReadyQueue(w.userId, 1);
    queue.failing = true;

    const reply = await generateOne(w.userId, item.itemId);

    expect(reply.status).toBe(200);
    const jobs = await storyJobs(w.userId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');
    expect(queue.enqueued).toEqual([]);
  });

  it('joins another person\'s active job that appears during the request: 200, no row, no slot used', async () => {
    const w = await world();
    const stranger = await data.user({ voiceId: w.voiceId });
    const [item] = await notReadyQueue(w.userId, 1);

    // The stranger inserts the active key and has NOT committed, so this person's state read
    // does not see it and the insert of this person waits on the unique index, then conflicts.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const insertDone = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.generationJob.create({
          data: {
            kind: 'write_story',
            payload: { kind: 'write_story', topicId: item.topicId, voiceId: w.voiceId },
            dedupeKey: `write_story:${item.topicId}`,
            requestedByUserId: stranger,
            status: 'running',
            startedAt: new Date(),
          },
        });
        inserted();
        await gate;
      },
      { timeout: 30_000 },
    );
    let pending: Promise<Reply> | undefined;
    let waitingSeen = false;
    try {
      await insertDone;
      pending = generateOne(w.userId, item.itemId);
      for (let attempt = 0; attempt < 100 && !waitingSeen; attempt++) {
        const rows = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query ILIKE '%INSERT INTO generation_jobs%'
            AND pid <> pg_backend_pid()
        `;
        waitingSeen = rows[0].n > 0;
        if (!waitingSeen) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release();
      await holder;
    }
    const reply = await (pending as Promise<Reply>);

    expect(waitingSeen).toBe(true);
    expect(reply.status).toBe(200);
    expect(await storyJobCount(w.userId)).toBe(0);
    const body = parseQueue(reply);
    expect(body.generations.left).toBe(5);
    expect(body.items[0].state).toBe('creating');
    expect(queue.enqueued).toEqual([]);
  });

  describe('with the users-row lock held', () => {
    it('counts what the holder inserted: left=1 becomes 0, so the request is refused and creates nothing', async () => {
      const w = await world();
      const [item] = await notReadyQueue(w.userId, 1);
      await spend(w.userId, 4);
      const unrelated = await data.topic();

      const reply = await requestWhileLockHeld(
        w.userId,
        () => generateOne(w.userId, item.itemId),
        async (tx) => {
          await tx.generationJob.create({
            data: {
              kind: 'write_story',
              payload: { kind: 'write_story', topicId: unrelated.topicId, voiceId: w.voiceId },
              dedupeKey: `write_story:${unrelated.topicId}`,
              requestedByUserId: w.userId,
              status: 'pending',
            },
          });
        },
      );

      // Without the lock the request read left=1 before the insert and started the story.
      expect(reply.status).toBe(429);
      expect(reply.json).toEqual(LIMIT_BODY);
      const keys = (await storyJobs(w.userId)).filter((job) => job.status === 'pending').map((job) => job.dedupeKey);
      expect(keys).toEqual([`write_story:${unrelated.topicId}`]);
    });

    it('answers 200 and creates nothing when the holder already started the SAME item', async () => {
      const w = await world();
      const [item] = await notReadyQueue(w.userId, 1);
      await spend(w.userId, 4);

      const reply = await requestWhileLockHeld(
        w.userId,
        () => generateOne(w.userId, item.itemId),
        async (tx) => {
          await tx.generationJob.create({
            data: {
              kind: 'write_story',
              payload: { kind: 'write_story', topicId: item.topicId, voiceId: w.voiceId },
              dedupeKey: `write_story:${item.topicId}`,
              requestedByUserId: w.userId,
              status: 'pending',
            },
          });
        },
      );

      // The item is now `creating`: a no-op, not a refusal, even though left is 0.
      expect(reply.status).toBe(200);
      expect(parseQueue(reply).items[0].state).toBe('creating');
      expect((await storyJobs(w.userId)).filter((job) => job.status === 'pending')).toHaveLength(1);
      expect(queue.enqueued).toEqual([]);
    });
  });

  // A probabilistic check: without the lock the two transactions usually overlap but nothing
  // forces it. The tests with the lock held above are the deterministic guard.
  it('lets exactly one of two concurrent starts through when one generation is left', async () => {
    const w = await world();
    const items = await notReadyQueue(w.userId, 2);
    await spend(w.userId, 4);

    const replies = await Promise.all(items.map((item) => generateOne(w.userId, item.itemId)));

    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 429]);
    expect((await storyJobs(w.userId)).filter((job) => job.status === 'pending')).toHaveLength(1);
    expect(queue.enqueued).toHaveLength(1);
  });
});

describe('POST /api/queue/generate', () => {
  it('starts every not_ready and failed item, skips ready and creating ones', async () => {
    const w = await world();
    const stranger = await data.user({ voiceId: w.voiceId });
    const fresh = await data.topic();
    const failedWithStory = await data.topic({ story: true });
    const ready = await data.topic({ story: true, audioVoiceIds: [w.voiceId] });
    const creating = await data.topic();
    await data.job({
      userId: stranger,
      kind: 'write_story',
      status: 'running',
      dedupeKey: `write_story:${creating.topicId}`,
    });
    await data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'failed',
      dedupeKey: `render_audio:${failedWithStory.storyId}:${w.voiceId}`,
    });
    for (const [index, topic] of [fresh, failedWithStory, ready, creating].entries()) {
      await data.queueItem(w.userId, topic.topicId, index + 1);
    }

    const reply = await generateAll(w.userId);

    expect(reply.status).toBe(200);
    const pending = (await storyJobs(w.userId)).filter((job) => job.status === 'pending');
    expect(pending.map((job) => job.dedupeKey).sort()).toEqual(
      [`write_story:${fresh.topicId}`, `render_audio:${failedWithStory.storyId}:${w.voiceId}`].sort(),
    );
    expect(parseQueue(reply).generations.left).toBe(3);
    expect(queue.enqueued.sort()).toEqual(pending.map((job) => job.id).sort());
  });

  it('is all-or-nothing: three targets with two left gives 429, the exact body and ZERO rows', async () => {
    const w = await world();
    await notReadyQueue(w.userId, 3);
    await spend(w.userId, 3);
    const before = await storyJobCount(w.userId);

    const reply = await generateAll(w.userId);

    expect(reply.status).toBe(429);
    expect(reply.json).toEqual(LIMIT_BODY);
    expect(await storyJobCount(w.userId)).toBe(before);
    expect(queue.enqueued).toEqual([]);
  });

  it('answers 200 for an empty queue and when everything is ready, also at zero left', async () => {
    const w = await world();
    await spend(w.userId, 5);
    expect((await generateAll(w.userId)).status).toBe(200);

    const topic = await data.topic({ story: true, audioVoiceIds: [w.voiceId] });
    await data.queueItem(w.userId, topic.topicId, 1);
    expect((await generateAll(w.userId)).status).toBe(200);
    expect((await storyJobs(w.userId)).filter((job) => job.status === 'pending')).toHaveLength(0);
  });

  it('starts all targets when exactly as many generations are left', async () => {
    const w = await world();
    await notReadyQueue(w.userId, 2);
    await spend(w.userId, 3);

    const reply = await generateAll(w.userId);

    expect(reply.status).toBe(200);
    expect(parseQueue(reply).generations.left).toBe(0);
    expect((await storyJobs(w.userId)).filter((job) => job.status === 'pending')).toHaveLength(2);
  });
});
