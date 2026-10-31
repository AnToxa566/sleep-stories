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
import { StorageService } from '../providers/storage/storage.service';

// Runs against the REAL local database with the real AppModule. Only the key source of the
// access-token verifier is replaced (as in voices.int-spec.ts), and StorageService is a mock
// that returns opaque URLs which do not contain the object path, so a path leaking into a
// response can be told apart from a URL. Every test builds its own voice and people with
// random ids (QueueTestData), and everything is removed afterwards.
assertLocalDatabase();

const KID = 'int-test-key';

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let baseUrl: string;
let issuer: string;
let signingKey: CryptoKey;
const signMany = jest.fn<Promise<string[]>, [readonly string[], number]>();
const opaqueUrls = async (paths: readonly string[]) =>
  paths.map((_path, index) => `https://signed.example.test/opaque-${index}?token=fake`);

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

async function call(method: string, path: string, userId?: string, body?: unknown) {
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
const getQueue = (userId?: string) => call('GET', '/queue', userId);
const del = (userId: string | undefined, itemId: string) => call('DELETE', `/queue/items/${itemId}`, userId);
const put = (userId: string | undefined, itemIds: unknown) => call('PUT', '/queue/order', userId, { itemIds });

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
  signMany.mockReset();
  signMany.mockImplementation(opaqueUrls);
});

afterAll(async () => {
  await data?.cleanup();
  await app?.close();
});

async function world() {
  const voiceId = await data.voice();
  const otherVoiceId = await data.voice();
  const userId = await data.user({ voiceId });
  return { voiceId, otherVoiceId, userId };
}

// A queue of `count` plain topics at the given positions; returns the item ids in position order.
async function plainQueue(userId: string, positions: number[]): Promise<string[]> {
  for (const [index, position] of positions.entries()) {
    const topic = await data.topic({ style: index % 2 === 0 ? 'facts' : 'history' });
    await data.queueItem(userId, topic.topicId, position);
  }
  return itemIdsOf(userId);
}
async function itemRows(userId: string) {
  return prisma.queueItem.findMany({
    where: { userId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true, topicId: true },
  });
}
const itemIdsOf = async (userId: string) => (await itemRows(userId)).map((row) => row.id);
const positionsOf = async (userId: string) => (await itemRows(userId)).map((row) => row.position);
const responseIds = (json: unknown) => QueueResponseSchema.parse(json).items.map((item) => item.id);

// Proves a route takes the users-row lock. Holds `SELECT ... FOR UPDATE` on the person's
// `users` row in an open transaction, fires the request WITHOUT awaiting it, waits until a
// backend is seen waiting on that lock (pg_stat_activity), and only then inserts a queue
// item at max+1 (as the top-up does) and commits. A route that takes the lock reads and
// writes after that insert; a route that does not has already finished, or never waits.
async function requestWhileLockHeld(
  userId: string,
  fire: () => Promise<{ status: number; text: string; json: unknown }>,
): Promise<{ response: { status: number; text: string; json: unknown }; insertedId: string }> {
  const extra = await data.topic();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let insertedId = '';
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      locked();
      await gate;
      const max = await tx.queueItem.aggregate({ where: { userId }, _max: { position: true } });
      const row = await tx.queueItem.create({
        data: { userId, topicId: extra.topicId, position: (max._max.position ?? 0) + 1 },
        select: { id: true },
      });
      insertedId = row.id;
    },
    { timeout: 30_000 },
  );
  let pending: ReturnType<typeof fire> | undefined;
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
  return { response: await (pending as ReturnType<typeof fire>), insertedId };
}

describe('authentication', () => {
  it('answers 401 with the error schema body without a token, on every route', async () => {
    for (const result of [
      await getQueue(),
      await del(undefined, randomUUID()),
      await put(undefined, []),
    ]) {
      expect(result.status).toBe(401);
      expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({ statusCode: 401, code: 'unauthorized' });
    }
  });
});

describe('GET /api/queue', () => {
  it('shows the four states in position order, each from the data', async () => {
    const w = await world();
    const stranger = await data.user({ voiceId: w.voiceId });

    const readyTopic = await data.topic({ story: true, audioVoiceIds: [w.voiceId] });
    // creating: an active write_story requested by ANOTHER person.
    const creatingTopic = await data.topic();
    await data.job({
      userId: stranger,
      kind: 'write_story',
      status: 'running',
      dedupeKey: `write_story:${creatingTopic.topicId}`,
    });
    // failed: the render of an existing story in this voice finally failed.
    const failedTopic = await data.topic({ story: true });
    await data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'failed',
      dedupeKey: `render_audio:${failedTopic.storyId}:${w.voiceId}`,
    });
    const plainTopic = await data.topic();
    await data.queueItem(w.userId, readyTopic.topicId, 1);
    await data.queueItem(w.userId, creatingTopic.topicId, 2);
    await data.queueItem(w.userId, failedTopic.topicId, 3);
    await data.queueItem(w.userId, plainTopic.topicId, 4);

    const result = await getQueue(w.userId);
    expect(result.status).toBe(200);
    const body = QueueResponseSchema.parse(result.json);
    expect(body.items.map((item) => item.state)).toEqual(['ready', 'creating', 'failed', 'not_ready']);
    expect(body.items.map((item) => item.topicId)).toEqual([
      readyTopic.topicId,
      creatingTopic.topicId,
      failedTopic.topicId,
      plainTopic.topicId,
    ]);
    expect(body.items[0]).toMatchObject({
      storyId: readyTopic.storyId,
      durationSec: 60,
      audioUrl: 'https://signed.example.test/opaque-0?token=fake',
    });
    // Another person's active job and a failed job hold none of this person's slots.
    expect(body.generations).toEqual({ left: 5, limit: 5 });
  });

  it('lets the newest job of the key decide', async () => {
    const w = await world();
    const topic = await data.topic();
    const olderFailed = await data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${topic.topicId}`,
    });
    await prisma.generationJob.update({
      where: { id: olderFailed },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    const newer = await data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'pending',
      dedupeKey: `write_story:${topic.topicId}`,
    });
    await data.queueItem(w.userId, topic.topicId, 1);
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).items[0].state).toBe('creating');

    // The newer job succeeds (without leaving audio): the older failure no longer counts.
    await data.markJob(newer, 'succeeded');
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).items[0].state).toBe('not_ready');

    // A failure newer than a success is a failure.
    await data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${topic.topicId}`,
    });
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).items[0].state).toBe('failed');
  });

  it('treats audio in another voice as not_ready and never signs or shows its path', async () => {
    const w = await world();
    const topic = await data.topic({ story: true, audioVoiceIds: [w.otherVoiceId] });
    await data.queueItem(w.userId, topic.topicId, 1);
    const otherPath = (
      await prisma.storyAudio.findFirstOrThrow({
        where: { storyId: topic.storyId as string },
        select: { storagePath: true },
      })
    ).storagePath;

    const result = await getQueue(w.userId);
    expect(result.status).toBe(200);
    expect(QueueResponseSchema.parse(result.json).items[0].state).toBe('not_ready');
    expect(signMany).not.toHaveBeenCalled();
    expect(result.text).not.toContain(otherPath);
  });

  it('keeps an item ready while a render_audio job for it runs (audio in the voice wins)', async () => {
    const w = await world();
    const topic = await data.topic({ story: true, audioVoiceIds: [w.voiceId] });
    await data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'running',
      dedupeKey: `render_audio:${topic.storyId}:${w.voiceId}`,
    });
    await data.queueItem(w.userId, topic.topicId, 1);
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).items[0].state).toBe('ready');
  });

  it('ignores an active render_audio job in another voice (the key includes the voice)', async () => {
    const w = await world();
    const topic = await data.topic({ story: true });
    await data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'running',
      dedupeKey: `render_audio:${topic.storyId}:${w.otherVoiceId}`,
    });
    await data.queueItem(w.userId, topic.topicId, 1);
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).items[0].state).toBe('not_ready');
  });

  it('returns an empty queue and the full allowance for a person with no preferences', async () => {
    const userId = await data.user();
    const result = await getQueue(userId);
    expect(result.status).toBe(200);
    expect(QueueResponseSchema.parse(result.json)).toEqual({
      items: [],
      generations: { left: 5, limit: 5 },
    });
    expect(signMany).not.toHaveBeenCalled();
  });

  it('returns an empty queue for a person with no row at all', async () => {
    const result = await getQueue(randomUUID());
    expect(result.status).toBe(200);
    expect(QueueResponseSchema.parse(result.json).items).toEqual([]);
  });

  it('lowers generations.left after a succeeded render in the window, not after a failed one', async () => {
    const w = await world();
    const left = async () => QueueResponseSchema.parse((await getQueue(w.userId)).json).generations.left;
    expect(await left()).toBe(5);
    await data.job({ userId: w.userId, kind: 'render_audio', status: 'failed', hoursAgo: 1 });
    expect(await left()).toBe(5);
    await data.job({ userId: w.userId, kind: 'render_audio', status: 'succeeded', hoursAgo: 25 });
    expect(await left()).toBe(5);
    await data.job({ userId: w.userId, kind: 'render_audio', status: 'succeeded', hoursAgo: 1 });
    expect(await left()).toBe(4);
    await data.job({ userId: w.userId, kind: 'write_story', status: 'running' });
    expect(await left()).toBe(3);
  });

  it('does not count another person\'s generations', async () => {
    const w = await world();
    const stranger = await data.user({ voiceId: w.voiceId });
    await data.job({ userId: stranger, kind: 'render_audio', status: 'succeeded', hoursAgo: 1 });
    expect(QueueResponseSchema.parse((await getQueue(w.userId)).json).generations.left).toBe(5);
  });

  it('signs all ready paths in one call for 30 minutes and leaks no storage path', async () => {
    const w = await world();
    const topics = [
      await data.topic({ story: true, audioVoiceIds: [w.voiceId] }),
      await data.topic(),
      await data.topic({ story: true, audioVoiceIds: [w.voiceId] }),
    ];
    for (const [index, topic] of topics.entries()) await data.queueItem(w.userId, topic.topicId, index + 1);
    const paths = (
      await prisma.storyAudio.findMany({
        where: { storyId: { in: [topics[0].storyId as string, topics[2].storyId as string] } },
        select: { storyId: true, storagePath: true },
      })
    );
    const pathOf = (storyId: string | null) => paths.find((p) => p.storyId === storyId)?.storagePath;

    const result = await getQueue(w.userId);
    expect(result.status).toBe(200);
    expect(signMany).toHaveBeenCalledTimes(1);
    expect(signMany).toHaveBeenCalledWith([pathOf(topics[0].storyId), pathOf(topics[2].storyId)], 1800);
    expect(result.text).not.toMatch(/stories\/|\.mp3|storagePath|storage_path/);
    for (const p of paths) expect(result.text).not.toContain(p.storagePath);
    const items = QueueResponseSchema.parse(result.json).items;
    expect(items[0]).toMatchObject({ audioUrl: 'https://signed.example.test/opaque-0?token=fake' });
    expect(items[2]).toMatchObject({ audioUrl: 'https://signed.example.test/opaque-1?token=fake' });
  });

  it('shows only the caller\'s own queue', async () => {
    const a = await world();
    const b = await world();
    const ids = await plainQueue(a.userId, [1, 2]);
    expect(responseIds((await getQueue(a.userId)).json)).toEqual(ids);
    expect(responseIds((await getQueue(b.userId)).json)).toEqual([]);
  });
});

describe('DELETE /api/queue/items/:itemId', () => {
  it('removes the item, renumbers the rest 1..n and returns the new queue', async () => {
    const w = await world();
    const [first, second, third, fourth] = await plainQueue(w.userId, [3, 7, 9, 12]);

    const result = await del(w.userId, second);
    expect(result.status).toBe(200);
    expect(responseIds(result.json)).toEqual([first, third, fourth]);
    expect(await itemIdsOf(w.userId)).toEqual([first, third, fourth]);
    expect(await positionsOf(w.userId)).toEqual([1, 2, 3]);
  });

  it('answers 404 with one identical body for a foreign item and a random id, and keeps the foreign item', async () => {
    const a = await world();
    const b = await world();
    const aIds = await plainQueue(a.userId, [1, 2]);
    await plainQueue(b.userId, [1]);

    const foreign = await del(b.userId, aIds[0]);
    const random = await del(b.userId, randomUUID());
    expect(foreign.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(foreign.json)).toMatchObject({
      statusCode: 404,
      code: 'queue_item_not_found',
    });
    expect(foreign.text).toBe(random.text);
    expect(await itemIdsOf(a.userId)).toEqual(aIds);
    expect(await positionsOf(a.userId)).toEqual([1, 2]);
    expect(await positionsOf(b.userId)).toEqual([1]);
  });

  it('answers 400 validation_failed for a malformed id', async () => {
    const w = await world();
    const result = await call('DELETE', '/queue/items/not-a-uuid', w.userId);
    expect(result.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({ statusCode: 400, code: 'validation_failed' });
  });

  it('waits for the users-row lock: the renumbering includes an item added meanwhile', async () => {
    const w = await world();
    const [a, b, c] = await plainQueue(w.userId, [1, 2, 3]);

    const { response, insertedId } = await requestWhileLockHeld(w.userId, () => del(w.userId, b));

    expect(response.status).toBe(200);
    // Without the lock the renumbering ran before the insert and left positions 1, 2, 4.
    expect(await itemIdsOf(w.userId)).toEqual([a, c, insertedId]);
    expect(await positionsOf(w.userId)).toEqual([1, 2, 3]);
  });

  it('creates no generation job', async () => {
    const w = await world();
    const ids = await plainQueue(w.userId, [1, 2]);
    await del(w.userId, ids[0]);
    expect(await prisma.generationJob.count({ where: { requestedByUserId: w.userId } })).toBe(0);
  });
});

describe('PUT /api/queue/order', () => {
  it('applies a valid order, positions 1..n, and returns the new queue', async () => {
    const w = await world();
    const [a, b, c] = await plainQueue(w.userId, [4, 8, 15]);

    const result = await put(w.userId, [c, a, b]);
    expect(result.status).toBe(200);
    expect(responseIds(result.json)).toEqual([c, a, b]);
    expect(await itemIdsOf(w.userId)).toEqual([c, a, b]);
    expect(await positionsOf(w.userId)).toEqual([1, 2, 3]);
  });

  it('accepts an empty list for an empty queue', async () => {
    const w = await world();
    const result = await put(w.userId, []);
    expect(result.status).toBe(200);
    expect(responseIds(result.json)).toEqual([]);
  });

  it('answers 409 for another person\'s ids and leaves that person\'s order unchanged', async () => {
    const a = await world();
    const b = await world();
    const aIds = await plainQueue(a.userId, [1, 2, 3]);
    const bIds = await plainQueue(b.userId, [1, 2]);

    for (const sent of [[...aIds].reverse(), [...bIds, aIds[0]], []]) {
      const result = await put(b.userId, sent);
      expect(result.status).toBe(409);
      expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({
        statusCode: 409,
        code: 'queue_order_mismatch',
      });
    }
    expect(await itemIdsOf(a.userId)).toEqual(aIds);
    expect(await positionsOf(a.userId)).toEqual([1, 2, 3]);
    expect(await itemIdsOf(b.userId)).toEqual(bIds);
    expect(await positionsOf(b.userId)).toEqual([1, 2]);
  });

  it('rejects a missing, an extra or a repeated id and writes nothing', async () => {
    const w = await world();
    const [a, b, c] = await plainQueue(w.userId, [1, 2, 3]);

    expect((await put(w.userId, [c, a])).status).toBe(409);
    expect((await put(w.userId, [c, b, a, randomUUID()])).status).toBe(409);
    expect((await put(w.userId, [c, c, a])).status).toBe(400);
    expect((await put(w.userId, [a, b, 'nope'])).status).toBe(400);
    expect(await itemIdsOf(w.userId)).toEqual([a, b, c]);
    expect(await positionsOf(w.userId)).toEqual([1, 2, 3]);
  });

  it('creates no generation job', async () => {
    const w = await world();
    const ids = await plainQueue(w.userId, [1, 2]);
    await put(w.userId, [ids[1], ids[0]]);
    expect(await prisma.generationJob.count({ where: { requestedByUserId: w.userId } })).toBe(0);
  });

  it('waits for the users-row lock: a stale list is refused, not applied', async () => {
    const w = await world();
    const [a, b, c] = await plainQueue(w.userId, [1, 2, 3]);

    const { response, insertedId } = await requestWhileLockHeld(w.userId, () =>
      put(w.userId, [c, a, b]),
    );

    // The PUT read the queue after the lock was released, saw the inserted item and refused
    // its now-stale list. Without the lock it would have applied it (200).
    expect(response.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(response.json)).toMatchObject({ code: 'queue_order_mismatch' });
    expect(await itemIdsOf(w.userId)).toEqual([a, b, c, insertedId]);
    expect(await positionsOf(w.userId)).toEqual([1, 2, 3, 4]);
  });
});
