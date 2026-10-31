import { randomUUID } from 'node:crypto';
import { ApiErrorResponseSchema, TopicsResponseSchema } from '@sleep-stories/contracts';
import { type Harness, startHarness } from '../../test-support/http-harness';

// GET /api/topics against the real local database and the real AppModule: the states, the
// filters, and what the list must never show (SECURITY.md rule 10). The finder rules
// themselves are covered in queue-candidates.int-spec.ts.
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function world() {
  const voiceId = await h.data.voice();
  const otherVoiceId = await h.data.voice();
  const interestId = await h.data.interest();
  const userId = await h.data.user({ voiceId, interestIds: [interestId] });
  const strangerId = await h.data.user({ voiceId, interestIds: [interestId] });
  return { voiceId, otherVoiceId, interestId, userId, strangerId };
}

const list = async (userId: string | undefined, query = '') => h.call('GET', `/topics${query}`, userId);
async function rowsOf(userId: string, query = '') {
  const response = await list(userId, query);
  expect(response.status).toBe(200);
  return TopicsResponseSchema.parse(response.json).topics;
}

describe('GET /api/topics', () => {
  it('answers 401 with the error schema body without a token', async () => {
    const response = await list(undefined);
    expect(response.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(response.json)).toMatchObject({ statusCode: 401, code: 'unauthorized' });
  });

  it('returns an empty list for a person without preferences', async () => {
    const userId = await h.data.user();
    const response = await list(userId);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ topics: [] });
  });

  it('shows ready with a duration, not_ready, creating, a failed topic in the queue, and hides a failed one outside it', async () => {
    const w = await world();
    const ready = await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    const otherVoice = await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.otherVoiceId] });
    const plain = await h.data.topic({ interestId: w.interestId, story: true });
    const creating = await h.data.topic({ interestId: w.interestId });
    await h.data.userTopic(w.userId, creating.topicId, 'proposed');
    await h.data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'running',
      dedupeKey: `write_story:${creating.topicId}`,
    });
    const failedQueued = await h.data.topic({ interestId: w.interestId });
    await h.data.userTopic(w.userId, failedQueued.topicId, 'proposed');
    await h.data.queueItem(w.userId, failedQueued.topicId, 1);
    await h.data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${failedQueued.topicId}`,
    });
    const failedHidden = await h.data.topic({ interestId: w.interestId });
    await h.data.userTopic(w.userId, failedHidden.topicId, 'proposed');
    await h.data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${failedHidden.topicId}`,
    });

    const rows = await rowsOf(w.userId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ready.topicId)).toMatchObject({ state: 'ready', durationSec: 60, inQueue: false });
    expect(byId.get(otherVoice.topicId)).toMatchObject({ state: 'not_ready', durationSec: null });
    expect(byId.get(plain.topicId)).toMatchObject({ state: 'not_ready', durationSec: null });
    expect(byId.get(creating.topicId)).toMatchObject({ state: 'creating', durationSec: null });
    expect(byId.get(failedQueued.topicId)).toMatchObject({ state: 'failed', inQueue: true });
    expect(byId.has(failedHidden.topicId)).toBe(false);
    expect(rows[0].id).toBe(ready.topicId);
  });

  it('never carries an audio URL, a story id or a storage path', async () => {
    const w = await world();
    await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    const response = await list(w.userId);
    expect(response.text).not.toMatch(/audioUrl|storyId|storagePath|test\/.*\.mp3/);
  });

  it('filters by style, by ready=true and by both, and ready=false gives the rest', async () => {
    const voiceId = await h.data.voice();
    const interestId = await h.data.interest();
    const userId = await h.data.user({ voiceId, interestIds: [interestId], styles: ['facts', 'history'] });
    const facts = await h.data.topic({ interestId, story: true, audioVoiceIds: [voiceId] });
    const history = await h.data.topic({ interestId, style: 'history', story: true });
    const ids = async (query: string) => new Set((await rowsOf(userId, query)).map((row) => row.id));
    expect(await ids('')).toEqual(new Set([facts.topicId, history.topicId]));
    expect(await ids('?style=history')).toEqual(new Set([history.topicId]));
    expect(await ids('?ready=true')).toEqual(new Set([facts.topicId]));
    expect(await ids('?ready=false')).toEqual(new Set([history.topicId]));
    expect(await ids('?style=history&ready=true')).toEqual(new Set());
  });

  it('answers 400 for an unknown style, a bad ready and an unknown query key', async () => {
    const w = await world();
    for (const query of ['?style=comedy', '?ready=yes', '?userId=' + randomUUID()]) {
      const response = await list(w.userId, query);
      expect(response.status).toBe(400);
      expect(ApiErrorResponseSchema.parse(response.json)).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('omits another person\'s typed topic and a NULL-interest pool topic, however ready they are', async () => {
    const w = await world();
    const typed = await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.userTopic(w.strangerId, typed.topicId, 'requested');
    const nullInterest = await h.data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.userTopic(w.strangerId, nullInterest.topicId, 'proposed');
    const ok = await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    const ids = (await rowsOf(w.userId)).map((row) => row.id);
    expect(ids).toContain(ok.topicId);
    expect(ids).not.toContain(typed.topicId);
    expect(ids).not.toContain(nullInterest.topicId);
  });

  it('shows the author their own NULL-interest proposed topic and nobody else', async () => {
    const w = await world();
    const mine = await h.data.topic({ interestId: null });
    await h.data.userTopic(w.userId, mine.topicId, 'proposed');
    expect((await rowsOf(w.userId)).map((row) => row.id)).toContain(mine.topicId);
    expect((await rowsOf(w.strangerId)).map((row) => row.id)).not.toContain(mine.topicId);
  });

  it('omits heard, dismissed, rated -1 and out-of-style topics', async () => {
    const w = await world();
    const heard = await h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.listen(w.userId, heard.storyId as string, w.voiceId);
    const disliked = await h.data.topic({ interestId: w.interestId, story: true });
    await h.data.rating(w.userId, disliked.storyId as string, -1);
    const dismissed = await h.data.topic({ interestId: w.interestId });
    await h.data.userTopic(w.userId, dismissed.topicId, 'proposed', { dismissed: true });
    const otherStyle = await h.data.topic({ interestId: w.interestId, style: 'history', story: true });
    const ids = (await rowsOf(w.userId)).map((row) => row.id);
    for (const hidden of [heard, disliked, dismissed, otherStyle]) {
      expect(ids).not.toContain(hidden.topicId);
    }
  });

  it('creates no job and writes no row', async () => {
    const w = await world();
    await h.data.topic({ interestId: w.interestId, story: true });
    const jobsBefore = await h.prisma.generationJob.count();
    const topicsBefore = await h.prisma.userTopic.count();
    await list(w.userId);
    expect(await h.prisma.generationJob.count()).toBe(jobsBefore);
    expect(await h.prisma.userTopic.count()).toBe(topicsBefore);
  });
});
