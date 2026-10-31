import { randomUUID } from 'node:crypto';
import { ApiErrorResponseSchema, QueueResponseSchema } from '@sleep-stories/contracts';
import { type Harness, type HttpResult, startHarness } from '../../test-support/http-harness';

// POST /api/queue/items, /items/:itemId/replace and /items/:itemId/another against the real
// local database and the real AppModule. The mandatory cases of the cycle 4b plan: the privacy
// of typed topics (one indistinguishable 404), the lock, the item keeping its place, and that
// no mutation creates a job or a dismissal.
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function world() {
  const voiceId = await h.data.voice();
  const interestId = await h.data.interest();
  const otherInterestId = await h.data.interest();
  const userId = await h.data.user({ voiceId, interestIds: [interestId] });
  const strangerId = await h.data.user({ voiceId, interestIds: [interestId] });
  return { voiceId, interestId, otherInterestId, userId, strangerId };
}
type World = Awaited<ReturnType<typeof world>>;

const add = (userId: string | undefined, topicIds: unknown) => h.call('POST', '/queue/items', userId, { topicIds });
const replace = (userId: string | undefined, itemId: string, topicId: unknown) =>
  h.call('POST', `/queue/items/${itemId}/replace`, userId, { topicId });
const another = (userId: string | undefined, itemId: string) =>
  h.call('POST', `/queue/items/${itemId}/another`, userId);

const readyTopic = (w: World, options: { style?: 'facts' | 'history' } = {}) =>
  h.data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId], style: options.style });
const plainTopic = (w: World) => h.data.topic({ interestId: w.interestId, story: true });

async function itemRows(userId: string) {
  return prisma().queueItem.findMany({
    where: { userId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true, topicId: true, createdAt: true },
  });
}
const prisma = () => h.prisma;
const topicIdsOf = async (userId: string) => (await itemRows(userId)).map((row) => row.topicId);
const responseTopicIds = (response: HttpResult) =>
  QueueResponseSchema.parse(response.json).items.map((item) => item.topicId);

function expectCode(response: HttpResult, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ApiErrorResponseSchema.parse(response.json)).toMatchObject({ statusCode: status, code });
}

// One queue item with a plain facts topic; returns its row.
async function oneItem(w: World, position = 1) {
  const topic = await plainTopic(w);
  await h.data.queueItem(w.userId, topic.topicId, position);
  const [row] = (await itemRows(w.userId)).filter((r) => r.topicId === topic.topicId);
  return row;
}

describe('authentication', () => {
  it('answers 401 with the error schema body without a token, on the three routes', async () => {
    for (const result of [
      await add(undefined, [randomUUID()]),
      await replace(undefined, randomUUID(), randomUUID()),
      await another(undefined, randomUUID()),
    ]) {
      expectCode(result, 401, 'unauthorized');
    }
  });
});

describe('privacy: a topic the person may not queue is one indistinguishable 404', () => {
  async function unavailableBody(w: World) {
    return (await add(w.userId, [randomUUID()])).text;
  }

  it('hides another person\'s typed topic from add, replace and another, byte for byte like a random id', async () => {
    const w = await world();
    const typed = await readyTopic(w);
    await h.data.userTopic(w.strangerId, typed.topicId, 'requested');
    const item = await oneItem(w);
    const before = await itemRows(w.userId);
    const reference = await unavailableBody(w);
    expect(JSON.parse(reference)).toMatchObject({ statusCode: 404, code: 'topic_unavailable' });
    expect(reference).not.toContain(typed.topicId);

    const viaAdd = await add(w.userId, [typed.topicId]);
    const viaReplace = await replace(w.userId, item.id, typed.topicId);
    expect(viaAdd.status).toBe(404);
    expect(viaAdd.text).toBe(reference);
    expect(viaReplace.text).toBe(reference);
    // «Другая история» has no id to compare: the typed topic is the only candidate and must not be chosen.
    expectCode(await another(w.userId, item.id), 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('hides a NULL-interest pool topic of another person on its own', async () => {
    const w = await world();
    const hidden = await h.data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.userTopic(w.strangerId, hidden.topicId, 'proposed');
    const item = await oneItem(w);
    const before = await itemRows(w.userId);
    const reference = await unavailableBody(w);
    expect((await add(w.userId, [hidden.topicId])).text).toBe(reference);
    expect((await replace(w.userId, item.id, hidden.topicId)).text).toBe(reference);
    expectCode(await another(w.userId, item.id), 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('refuses the whole request and writes nothing when one id of two is foreign', async () => {
    const w = await world();
    const valid = await readyTopic(w);
    const foreign = await readyTopic(w);
    await h.data.userTopic(w.strangerId, foreign.topicId, 'requested');
    const response = await add(w.userId, [valid.topicId, foreign.topicId]);
    expectCode(response, 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toEqual([]);
    const reversed = await add(w.userId, [foreign.topicId, valid.topicId]);
    expect(reversed.text).toBe(response.text);
    expect(await itemRows(w.userId)).toEqual([]);
  });

  const reasons: [string, (w: World) => Promise<string>][] = [
    [
      'heard',
      async (w) => {
        const t = await readyTopic(w);
        await h.data.listen(w.userId, t.storyId as string, w.voiceId);
        return t.topicId;
      },
    ],
    [
      'dismissed',
      async (w) => {
        const t = await h.data.topic({ interestId: w.interestId });
        await h.data.userTopic(w.userId, t.topicId, 'proposed', { dismissed: true });
        return t.topicId;
      },
    ],
    [
      'rated -1',
      async (w) => {
        const t = await readyTopic(w);
        await h.data.rating(w.userId, t.storyId as string, -1);
        return t.topicId;
      },
    ],
    ['outside the person\'s styles', async (w) => (await readyTopic(w, { style: 'history' })).topicId],
    [
      'outside the person\'s interests',
      async (w) => (await h.data.topic({ interestId: w.otherInterestId, story: true, audioVoiceIds: [w.voiceId] })).topicId,
    ],
    ['non-existent', async () => randomUUID()],
  ];

  it.each(reasons)('gives the same 404 body for a topic that is %s, in add and in replace', async (_name, make) => {
    const w = await world();
    const topicId = await make(w);
    const item = await oneItem(w);
    const before = await itemRows(w.userId);
    const reference = await unavailableBody(w);
    const viaAdd = await add(w.userId, [topicId]);
    const viaReplace = await replace(w.userId, item.id, topicId);
    expect(viaAdd.status).toBe(404);
    expect(viaAdd.text).toBe(reference);
    expect(viaReplace.status).toBe(404);
    expect(viaReplace.text).toBe(reference);
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('lets the author add their own NULL-interest proposed topic, and refuses it to another person', async () => {
    const w = await world();
    const mine = await h.data.topic({ interestId: null });
    await h.data.userTopic(w.userId, mine.topicId, 'proposed');
    const reference = await unavailableBody(w);
    expect((await add(w.strangerId, [mine.topicId])).text).toBe(reference);
    expect(await itemRows(w.strangerId)).toEqual([]);
    const response = await add(w.userId, [mine.topicId]);
    expect(response.status).toBe(200);
    expect(responseTopicIds(response)).toEqual([mine.topicId]);
  });
});

describe('the author\'s own NULL-interest topic once it has a story', () => {
  // A topic grown from a custom interest has no catalogue interest. After its story exists the
  // pool interest rule would never match it, so the author needs the own-row rule to keep
  // reaching it; another person must never get it.
  type Variant = [string, string, (w: World) => Promise<string>];
  const variants: Variant[] = [
    [
      'ready',
      'ready',
      async (w) => {
        const t = await h.data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
        await h.data.userTopic(w.userId, t.topicId, 'proposed');
        return t.topicId;
      },
    ],
    [
      'story only',
      'not_ready',
      async (w) => {
        const t = await h.data.topic({ interestId: null, story: true });
        await h.data.userTopic(w.userId, t.topicId, 'proposed');
        return t.topicId;
      },
    ],
    [
      'render pending',
      'creating',
      async (w) => {
        const t = await h.data.topic({ interestId: null, story: true });
        await h.data.userTopic(w.userId, t.topicId, 'proposed');
        await h.data.job({
          userId: w.userId,
          kind: 'render_audio',
          status: 'running',
          dedupeKey: `render_audio:${t.storyId}:${w.voiceId}`,
        });
        return t.topicId;
      },
    ],
  ];

  it.each(variants)('is listed, addable and replaceable by the author (%s), and unreachable for a stranger', async (_name, state, make) => {
    const w = await world();
    const topicId = await make(w);

    const listed = (await h.call('GET', '/topics', w.userId)).json as { topics: { id: string; state: string }[] };
    expect(listed.topics.find((row) => row.id === topicId)?.state).toBe(state);

    const reference = (await add(w.userId, [randomUUID()])).text;
    const strangerList = (await h.call('GET', '/topics', w.strangerId)).json as { topics: { id: string }[] };
    expect(strangerList.topics.map((row) => row.id)).not.toContain(topicId);
    const strangerItem = await oneItem({ ...w, userId: w.strangerId });
    expect((await add(w.strangerId, [topicId])).text).toBe(reference);
    expect((await replace(w.strangerId, strangerItem.id, topicId)).text).toBe(reference);
    expectCode(await another(w.strangerId, strangerItem.id), 404, 'topic_unavailable');
    expect(await topicIdsOf(w.strangerId)).toEqual([strangerItem.topicId]);

    const added = await add(w.userId, [topicId]);
    expect(added.status).toBe(200);
    expect(QueueResponseSchema.parse(added.json).items).toMatchObject([{ topicId, state }]);

    // Remove it from the queue, then put it in an item by replacing.
    const item = await oneItem(w, 5);
    await h.prisma.queueItem.deleteMany({ where: { userId: w.userId, topicId } });
    const replaced = await replace(w.userId, item.id, topicId);
    expect(replaced.status).toBe(200);
    expect(await topicIdsOf(w.userId)).toEqual([topicId]);
  });

  it('is refused to a person whose own row is missing or dismissed', async () => {
    const w = await world();
    const mine = await h.data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.userTopic(w.strangerId, mine.topicId, 'proposed');
    expect((await add(w.userId, [mine.topicId])).status).toBe(404);
    // A dismissed own row no longer opens the topic to its author.
    const dismissed = await h.data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
    await h.data.userTopic(w.userId, dismissed.topicId, 'proposed', { dismissed: true });
    expect((await add(w.userId, [dismissed.topicId])).status).toBe(404);
  });
});

describe('POST /api/queue/items (add)', () => {
  it('appends after the existing positions in the order sent, and returns the whole queue', async () => {
    const w = await world();
    const old = await oneItem(w, 7);
    const a = await readyTopic(w);
    const b = await plainTopic(w);
    const c = await plainTopic(w);
    const response = await add(w.userId, [c.topicId, a.topicId, b.topicId]);
    expect(response.status).toBe(200);
    expect(responseTopicIds(response)).toEqual([old.topicId, c.topicId, a.topicId, b.topicId]);
    expect((await itemRows(w.userId)).map((row) => row.position)).toEqual([7, 8, 9, 10]);
  });

  it('skips a topic that is queued already, quietly, and adds the rest', async () => {
    const w = await world();
    const old = await oneItem(w, 1);
    const fresh = await plainTopic(w);
    const response = await add(w.userId, [old.topicId, fresh.topicId]);
    expect(response.status).toBe(200);
    expect(await topicIdsOf(w.userId)).toEqual([old.topicId, fresh.topicId]);
    const again = await add(w.userId, [old.topicId]);
    expect(again.status).toBe(200);
    expect((await itemRows(w.userId)).map((row) => row.id)).toContain(old.id);
    expect(await itemRows(w.userId)).toHaveLength(2);
  });

  it('skips a queued topic quietly even after it stopped being eligible, and still adds a valid new one', async () => {
    const w = await world();
    const old = await readyTopic(w);
    await h.data.queueItem(w.userId, old.topicId, 1);
    await h.data.listen(w.userId, old.storyId as string, w.voiceId); // heard after it was queued
    const fresh = await plainTopic(w);
    const response = await add(w.userId, [old.topicId, fresh.topicId]);
    expect(response.status).toBe(200);
    expect(await topicIdsOf(w.userId)).toEqual([old.topicId, fresh.topicId]);
    // An ineligible id that is not queued still fails the whole request.
    const heardNotQueued = await readyTopic(w);
    await h.data.listen(w.userId, heardNotQueued.storyId as string, w.voiceId);
    expectCode(await add(w.userId, [old.topicId, heardNotQueued.topicId]), 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toHaveLength(2);
  });

  it('accepts a topic whose generation failed (the person can start it again)', async () => {
    const w = await world();
    const failed = await plainTopic(w);
    await h.data.job({
      userId: w.userId,
      kind: 'render_audio',
      status: 'failed',
      dedupeKey: `render_audio:${failed.storyId}:${w.voiceId}`,
    });
    const response = await add(w.userId, [failed.topicId]);
    expect(response.status).toBe(200);
    expect(QueueResponseSchema.parse(response.json).items[0]).toMatchObject({ state: 'failed' });
  });

  it('two parallel identical adds both answer 200 and leave one row', async () => {
    const w = await world();
    const t = await plainTopic(w);
    const [first, second] = await Promise.all([add(w.userId, [t.topicId]), add(w.userId, [t.topicId])]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await topicIdsOf(w.userId)).toEqual([t.topicId]);
  });

  it('answers 400 for more than 100 ids, an empty list, a repeat, a bad id and an extra key', async () => {
    const w = await world();
    const many = Array.from({ length: 101 }, () => randomUUID());
    for (const body of [many, [], [w.userId, w.userId], ['x']]) {
      expectCode(await add(w.userId, body), 400, 'validation_failed');
    }
    const extra = await h.call('POST', '/queue/items', w.userId, { topicIds: [randomUUID()], userId: w.strangerId });
    expectCode(extra, 400, 'validation_failed');
  });

  it('answers 400 and writes nothing when the queue would pass 100 items', async () => {
    const w = await world();
    for (let position = 1; position <= 99; position++) {
      const t = await h.data.topic({ interestId: w.interestId });
      await h.data.queueItem(w.userId, t.topicId, position);
    }
    const two = [await plainTopic(w), await plainTopic(w)];
    expectCode(await add(w.userId, two.map((t) => t.topicId)), 400, 'validation_failed');
    expect(await itemRows(w.userId)).toHaveLength(99);
    expect((await add(w.userId, [two[0].topicId])).status).toBe(200);
    expect(await itemRows(w.userId)).toHaveLength(100);
  });

  it('answers 400 for a person without preferences', async () => {
    const userId = await h.data.user();
    expectCode(await add(userId, [randomUUID()]), 400, 'validation_failed');
  });

  it('takes the users-row lock: an insert made while it was held is counted, positions stay distinct and contiguous', async () => {
    const w = await world();
    const t = await plainTopic(w);
    const { response, insertedId } = await h.requestWhileLockHeld(w.userId, () => add(w.userId, [t.topicId]));
    expect(response.status).toBe(200);
    const rows = await itemRows(w.userId);
    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows[0].id).toBe(insertedId);
    expect(rows[1].topicId).toBe(t.topicId);
  });
});

describe('POST /api/queue/items/:itemId/replace', () => {
  it('keeps the item id, its position and creation time and changes only the topic', async () => {
    const w = await world();
    await oneItem(w, 1);
    const item = await oneItem(w, 2);
    await oneItem(w, 3);
    const target = await readyTopic(w);
    const response = await replace(w.userId, item.id, target.topicId);
    expect(response.status).toBe(200);
    const after = (await itemRows(w.userId)).find((row) => row.id === item.id);
    expect(after).toEqual({ ...item, topicId: target.topicId });
    expect((await itemRows(w.userId)).map((row) => row.position)).toEqual([1, 2, 3]);
    expect(responseTopicIds(response)).toContain(target.topicId);
    expect(responseTopicIds(response)).not.toContain(item.topicId);
  });

  it('is a 200 with no change for the topic the item holds already', async () => {
    const w = await world();
    const item = await oneItem(w);
    const before = await itemRows(w.userId);
    const response = await replace(w.userId, item.id, item.topicId);
    expect(response.status).toBe(200);
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('answers 404 topic_unavailable for a topic that is in another item, and changes nothing', async () => {
    const w = await world();
    const first = await oneItem(w, 1);
    const second = await oneItem(w, 2);
    const before = await itemRows(w.userId);
    expectCode(await replace(w.userId, first.id, second.topicId), 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('gives the same 404 queue_item_not_found for a foreign item and a missing one, and leaves the foreign item alone', async () => {
    const w = await world();
    const foreign = await oneItem({ ...w, userId: w.strangerId });
    const target = await readyTopic(w);
    const viaForeign = await replace(w.userId, foreign.id, target.topicId);
    const viaMissing = await replace(w.userId, randomUUID(), target.topicId);
    expectCode(viaForeign, 404, 'queue_item_not_found');
    expect(viaForeign.text).toBe(viaMissing.text);
    expect((await itemRows(w.strangerId))[0]).toEqual(foreign);
    expect(await itemRows(w.userId)).toEqual([]);
  });

  it('accepts a topic whose generation failed', async () => {
    const w = await world();
    const item = await oneItem(w);
    const failed = await h.data.topic({ interestId: w.interestId });
    await h.data.userTopic(w.userId, failed.topicId, 'proposed');
    await h.data.job({
      userId: w.userId,
      kind: 'write_story',
      status: 'failed',
      dedupeKey: `write_story:${failed.topicId}`,
    });
    expect((await replace(w.userId, item.id, failed.topicId)).status).toBe(200);
    expect(await topicIdsOf(w.userId)).toEqual([failed.topicId]);
  });

  it('answers 400 for a bad body or id', async () => {
    const w = await world();
    const item = await oneItem(w);
    expectCode(await replace(w.userId, item.id, 'x'), 400, 'validation_failed');
    expectCode(await replace(w.userId, 'x', randomUUID()), 400, 'validation_failed');
  });

  it('takes the users-row lock', async () => {
    const w = await world();
    const item = await oneItem(w);
    const target = await readyTopic(w);
    const { response, insertedId } = await h.requestWhileLockHeld(w.userId, () =>
      replace(w.userId, item.id, target.topicId),
    );
    expect(response.status).toBe(200);
    const rows = await itemRows(w.userId);
    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows.find((row) => row.id === item.id)?.topicId).toBe(target.topicId);
    expect(rows.map((row) => row.id)).toContain(insertedId);
  });
});

describe('POST /api/queue/items/:itemId/another', () => {
  it('chooses a ready story before a story without audio, of the same style, and keeps the item in place', async () => {
    const voiceId = await h.data.voice();
    const interestId = await h.data.interest();
    const userId = await h.data.user({ voiceId, interestIds: [interestId], styles: ['facts', 'history'] });
    const w = { voiceId, interestId, otherInterestId: interestId, userId, strangerId: userId } as World;
    const item = await oneItem(w, 3);
    await h.data.topic({ interestId, story: true });
    await h.data.topic({ interestId, style: 'history', story: true, audioVoiceIds: [voiceId] });
    const ready = await readyTopic(w);
    for (let attempt = 0; attempt < 3; attempt++) {
      // Random within a source, but a ready story always wins: reset the item each time.
      const response = await another(userId, item.id);
      expect(response.status).toBe(200);
      const [row] = await itemRows(userId);
      expect(row).toMatchObject({ id: item.id, position: 3, createdAt: item.createdAt });
      expect(row.topicId).toBe(ready.topicId);
      await h.prisma.queueItem.updateMany({ where: { id: item.id, userId }, data: { topicId: item.topicId } });
    }
  });

  it('falls back to a story without audio, then to the person\'s own topic with no story', async () => {
    const w = await world();
    const item = await oneItem(w);
    const noAudio = await plainTopic(w);
    expect((await another(w.userId, item.id)).status).toBe(200);
    expect(await topicIdsOf(w.userId)).toEqual([noAudio.topicId]);

    const w2 = await world();
    const item2 = await oneItem(w2);
    const own = await h.data.topic({ interestId: null });
    await h.data.userTopic(w2.userId, own.topicId, 'proposed');
    expect((await another(w2.userId, item2.id)).status).toBe(200);
    expect(await topicIdsOf(w2.userId)).toEqual([own.topicId]);
  });

  it('never returns a queued, heard, dismissed, foreign or other-style topic: 404 and no change', async () => {
    const w = await world();
    const item = await oneItem(w, 1);
    await oneItem(w, 2);
    const heard = await readyTopic(w);
    await h.data.listen(w.userId, heard.storyId as string, w.voiceId);
    const typed = await readyTopic(w);
    await h.data.userTopic(w.strangerId, typed.topicId, 'requested');
    await readyTopic(w, { style: 'history' });
    const before = await itemRows(w.userId);
    expectCode(await another(w.userId, item.id), 404, 'topic_unavailable');
    expect(await itemRows(w.userId)).toEqual(before);
  });

  it('gives queue_item_not_found for a foreign item and a missing one', async () => {
    const w = await world();
    const foreign = await oneItem({ ...w, userId: w.strangerId });
    await readyTopic(w);
    const viaForeign = await another(w.userId, foreign.id);
    expectCode(viaForeign, 404, 'queue_item_not_found');
    expect((await another(w.userId, randomUUID())).text).toBe(viaForeign.text);
    expect((await itemRows(w.strangerId))[0]).toEqual(foreign);
  });

  it('takes the users-row lock', async () => {
    const w = await world();
    const item = await oneItem(w);
    const target = await readyTopic(w);
    const { response } = await h.requestWhileLockHeld(w.userId, () => another(w.userId, item.id));
    expect(response.status).toBe(200);
    const rows = await itemRows(w.userId);
    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows.find((row) => row.id === item.id)?.topicId).toBe(target.topicId);
  });
});

describe('no job and no dismissal', () => {
  it('creates no generation job and writes no dismissed_at in add, replace or another', async () => {
    const w = await world();
    const item = await oneItem(w);
    const a = await plainTopic(w);
    const b = await readyTopic(w);
    await plainTopic(w); // a candidate for «Другая история»
    const jobsBefore = await h.prisma.generationJob.count();
    const userTopicsBefore = await h.prisma.userTopic.count();

    expect((await add(w.userId, [a.topicId])).status).toBe(200);
    expect((await replace(w.userId, item.id, b.topicId)).status).toBe(200);
    expect((await another(w.userId, item.id)).status).toBe(200);
    await add(w.userId, [randomUUID()]);

    expect(await h.prisma.generationJob.count()).toBe(jobsBefore);
    expect(await h.prisma.userTopic.count()).toBe(userTopicsBefore);
    expect(await h.prisma.userTopic.count({ where: { userId: w.userId, dismissedAt: { not: null } } })).toBe(0);
  });
});
