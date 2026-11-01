import { randomUUID } from 'node:crypto';
import {
  ApiErrorResponseSchema,
  LISTEN_MIN_SEC,
  ListenReportResponseSchema,
} from '@sleep-stories/contracts';
import { type Harness, startHarness } from '../../test-support/http-harness';
import { LISTEN_DURATION_SLACK_SEC } from './listens.service';

// POST /api/listens against the real local database and the real AppModule.
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

// A person with a voice, a ready topic (story + audio of 60 seconds in that voice) queued at
// position 1 and a second plain topic queued at position 2.
async function world() {
  const voiceId = await h.data.voice();
  const otherVoiceId = await h.data.voice();
  const userId = await h.data.user({ voiceId });
  const ready = await h.data.topic({ audioVoiceIds: [voiceId] });
  const plain = await h.data.topic();
  await h.data.queueItem(userId, ready.topicId, 1);
  await h.data.queueItem(userId, plain.topicId, 2);
  return { voiceId, otherVoiceId, userId, ready, plain, storyId: ready.storyId as string };
}

const report = (userId: string | undefined, body: unknown) => h.call('POST', '/listens', userId, body);
const listensOf = (userId: string) => h.prisma.listen.findMany({ where: { userId } });
const positionsOf = async (userId: string) =>
  (await h.prisma.queueItem.findMany({ where: { userId }, orderBy: { position: 'asc' } })).map(
    (row) => ({ topicId: row.topicId, position: row.position }),
  );

describe('POST /api/listens', () => {
  it('answers 401 with the error schema body without a token', async () => {
    const response = await report(undefined, { storyId: randomUUID(), listenedSec: 30 });
    expect(response.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(response.json)).toMatchObject({ code: 'unauthorized' });
  });

  it('records a listen of the own story and removes its queue item, closing the gap', async () => {
    const w = await world();
    const before = Date.now();
    const response = await report(w.userId, { storyId: w.storyId, listenedSec: 45 });
    expect(response.status).toBe(200);
    expect(ListenReportResponseSchema.parse(response.json)).toEqual({ recorded: true });
    const rows = await listensOf(w.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: w.userId,
      storyId: w.storyId,
      voiceId: w.voiceId,
      listenedSec: 45,
    });
    expect(rows[0].listenedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await positionsOf(w.userId)).toEqual([{ topicId: w.plain.topicId, position: 1 }]);
  });

  it('records a listen when the story was no longer in the queue', async () => {
    const w = await world();
    await h.prisma.queueItem.deleteMany({ where: { userId: w.userId, topicId: w.ready.topicId } });
    const response = await report(w.userId, { storyId: w.storyId, listenedSec: 10 });
    expect(response.status).toBe(200);
    expect(ListenReportResponseSchema.parse(response.json)).toEqual({ recorded: true });
    expect(await listensOf(w.userId)).toHaveLength(1);
  });

  it('clamps listenedSec to the audio duration plus the slack', async () => {
    const w = await world();
    const response = await report(w.userId, { storyId: w.storyId, listenedSec: 100_000 });
    expect(response.status).toBe(200);
    const rows = await listensOf(w.userId);
    expect(rows[0].listenedSec).toBe(60 + LISTEN_DURATION_SLACK_SEC);
  });

  it('writes nothing below the minimum and leaves the queue as it was', async () => {
    const w = await world();
    const response = await report(w.userId, { storyId: w.storyId, listenedSec: LISTEN_MIN_SEC - 1 });
    expect(response.status).toBe(200);
    expect(ListenReportResponseSchema.parse(response.json)).toEqual({ recorded: false });
    expect(await listensOf(w.userId)).toHaveLength(0);
    expect(await positionsOf(w.userId)).toEqual([
      { topicId: w.ready.topicId, position: 1 },
      { topicId: w.plain.topicId, position: 2 },
    ]);
  });

  it('answers the same 404 for an unknown story and for a story with no audio in the voice', async () => {
    const w = await world();
    const noAudio = await h.data.topic({ audioVoiceIds: [w.otherVoiceId] });
    const unknown = await report(w.userId, { storyId: randomUUID(), listenedSec: 30 });
    const wrongVoice = await report(w.userId, { storyId: noAudio.storyId, listenedSec: 30 });
    expect(unknown.status).toBe(404);
    expect(wrongVoice.status).toBe(404);
    expect(wrongVoice.json).toEqual(unknown.json);
    expect(ApiErrorResponseSchema.parse(unknown.json)).toMatchObject({ statusCode: 404 });
    expect(await listensOf(w.userId)).toHaveLength(0);
  });

  it('answers 404 for a person who has not finished onboarding (no preferences)', async () => {
    const w = await world();
    const stranger = await h.data.user();
    const response = await report(stranger, { storyId: w.storyId, listenedSec: 30 });
    expect(response.status).toBe(404);
    expect(await listensOf(stranger)).toHaveLength(0);
  });

  it('ignores a user id or a voice in the body (rejected) and touches nobody else', async () => {
    const w = await world();
    const other = await h.data.user({ voiceId: w.voiceId });
    await h.data.queueItem(other, w.ready.topicId, 1);
    const smuggled = await report(w.userId, {
      storyId: w.storyId,
      listenedSec: 30,
      userId: other,
      voiceId: w.otherVoiceId,
    });
    expect(smuggled.status).toBe(400);
    const own = await report(w.userId, { storyId: w.storyId, listenedSec: 30 });
    expect(own.status).toBe(200);
    expect(await listensOf(other)).toHaveLength(0);
    expect(await positionsOf(other)).toEqual([{ topicId: w.ready.topicId, position: 1 }]);
  });

  it('rejects an invalid body with 400 and writes nothing', async () => {
    const w = await world();
    for (const body of [
      { storyId: 'nope', listenedSec: 30 },
      { storyId: w.storyId, listenedSec: -1 },
      { storyId: w.storyId, listenedSec: 1.5 },
      { storyId: w.storyId },
    ]) {
      expect((await report(w.userId, body)).status).toBe(400);
    }
    expect(await listensOf(w.userId)).toHaveLength(0);
  });

  it('takes the users-row lock: an item inserted while it was held keeps contiguous positions', async () => {
    const w = await world();
    const { response } = await h.requestWhileLockHeld(w.userId, () =>
      report(w.userId, { storyId: w.storyId, listenedSec: 30 }),
    );
    expect(response.status).toBe(200);
    const rows = await positionsOf(w.userId);
    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows.map((row) => row.topicId)).not.toContain(w.ready.topicId);
  });
});
