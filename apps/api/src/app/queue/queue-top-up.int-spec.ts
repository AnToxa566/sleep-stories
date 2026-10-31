import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersModule } from '../providers/providers.module';
import { JobQueue } from '../providers/job-queue/job-queue';
import { QueueModule } from './queue.module';
import { QueueTopUpService } from './queue-top-up.service';

// Runs against the REAL local database with the real PrismaModule and QueueModule. The job
// queue is a recording fake, so nothing is dispatched; no provider is ever called (the
// provider keys are fakes from the integration setup). Every test builds its own voice,
// interest and people with random ids, so tests do not see each other's pool topics.
assertLocalDatabase();

// For each enqueue call: the id and whether that job row was already visible to a separate
// connection at that moment. Visible means the top-up transaction had committed.
const enqueued: { id: string; visible: boolean }[] = [];

let app: INestApplication;
let prisma: PrismaService;
let service: QueueTopUpService;
let data: QueueTestData;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
      ProvidersModule,
      QueueModule,
    ],
  })
    .overrideProvider(JobQueue)
    .useValue({
      enqueue: async (id: string) => {
        const row = await prisma.generationJob.findUnique({ where: { id }, select: { id: true } });
        enqueued.push({ id, visible: row !== null });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  service = app.get(QueueTopUpService);
  data = new QueueTestData(prisma);
});

afterAll(async () => {
  await data.cleanup();
  await app.close();
});

beforeEach(() => {
  enqueued.length = 0;
});

// A person with preferences (facts) and one chosen interest, in a fresh voice.
async function world() {
  const voiceId = await data.voice();
  const otherVoiceId = await data.voice();
  const interestId = await data.interest();
  const otherInterestId = await data.interest();
  const userId = await data.user({ voiceId, interestIds: [interestId] });
  return { voiceId, otherVoiceId, interestId, otherInterestId, userId };
}
type World = Awaited<ReturnType<typeof world>>;

const ready = (w: World) =>
  data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
const lacksAudio = (w: World) => data.topic({ interestId: w.interestId, story: true });

async function queueOf(userId: string): Promise<{ topicId: string; position: number }[]> {
  return prisma.queueItem.findMany({
    where: { userId },
    orderBy: { position: 'asc' },
    select: { topicId: true, position: true },
  });
}
const queuedTopics = async (userId: string) => (await queueOf(userId)).map((i) => i.topicId);

async function jobsOf(userId: string) {
  return prisma.generationJob.findMany({
    where: { requestedByUserId: userId },
    select: { id: true, kind: true, status: true, payload: true, dedupeKey: true },
  });
}
async function succeededGenerations(userId: string, count: number, hoursAgo = 1) {
  for (let i = 0; i < count; i++) {
    await data.job({ userId, kind: 'render_audio', status: 'succeeded', hoursAgo });
  }
}

// AGENTS.md architecture rule 10: the top-up never creates a write_story or render_audio row.
// `before` is the set of job ids that existed before the run (seeded rows are not its work).
async function expectNoStoryJobCreated(userId: string, before: Set<string> = new Set()) {
  const created = (await jobsOf(userId)).filter((j) => !before.has(j.id));
  expect(created.filter((j) => j.kind === 'write_story' || j.kind === 'render_audio')).toEqual([]);
}
const idsOf = async (userId: string) => new Set((await jobsOf(userId)).map((j) => j.id));

describe('QueueTopUpService (database)', () => {
  describe('sources and queue length', () => {
    it('appends after the existing positions, ready before no-audio', async () => {
      const w = await world();
      const r = await ready(w);
      const d = await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const old = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(w.userId, old.topicId, 7);

      const result = await service.run(w.userId);

      expect(result).toMatchObject({ queued: { ready: 1, withoutAudio: 1, withoutStory: 0 } });
      expect(await queueOf(w.userId)).toEqual([
        { topicId: old.topicId, position: 7 },
        { topicId: r.topicId, position: 8 },
        { topicId: d.topicId, position: 9 },
      ]);
      // The queue held 1 item, so only 2 were needed: the story-less topic stays out.
      expect(result).toMatchObject({ queueLength: 3 });
      await expectNoStoryJobCreated(w.userId);
    });

    it('fills an empty queue with ready, no-audio and no-story in order, positions 1..3, and no job', async () => {
      const w = await world();
      const r = await ready(w);
      const d = await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');

      const result = await service.run(w.userId);

      expect(result).toMatchObject({
        queued: { ready: 1, withoutAudio: 1, withoutStory: 1 },
        suggestRequested: false,
        queueLength: 3,
      });
      expect(await queueOf(w.userId)).toEqual([
        { topicId: r.topicId, position: 1 },
        { topicId: d.topicId, position: 2 },
        { topicId: own.topicId, position: 3 },
      ]);
      // Nothing costs money here: not a single job, and nothing handed to the queue.
      expect(await jobsOf(w.userId)).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    it('does nothing for a person with no preferences or no users row', async () => {
      const bare = await data.user();
      await expect(service.run(bare)).resolves.toEqual({ skipped: 'no_preferences' });
      await expect(service.run('00000000-0000-4000-8000-0000000000aa')).resolves.toEqual({
        skipped: 'no_preferences',
      });
      expect(await queueOf(bare)).toEqual([]);
    });

    it('does nothing when the queue already holds 3', async () => {
      const w = await world();
      for (let i = 0; i < 3; i++) {
        const t = await ready(w);
        await data.queueItem(w.userId, t.topicId, i + 1);
      }
      await ready(w);
      await expect(service.run(w.userId)).resolves.toEqual({ skipped: 'queue_full' });
      expect(await queueOf(w.userId)).toHaveLength(3);
      expect(await jobsOf(w.userId)).toEqual([]);
    });

    it.each([
      [2, 1],
      [1, 2],
      [0, 3],
    ])('with %d in the queue it asks for %d', async (inQueue, asked) => {
      const w = await world();
      for (let i = 0; i < inQueue; i++) {
        const t = await data.topic({ interestId: w.interestId, story: true });
        await data.queueItem(w.userId, t.topicId, i + 1);
      }
      for (let i = 0; i < 4; i++) await ready(w);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: asked }, queueLength: 3 });
      expect(await queueOf(w.userId)).toHaveLength(3);
    });
  });

  describe('fit', () => {
    // A control ready topic is always present; the case under test must not be queued.
    async function onlyControl(w: World, unfit: { topicId: string }) {
      const control = await ready(w);
      const result = await service.run(w.userId);
      const queued = await queuedTopics(w.userId);
      expect(queued).toContain(control.topicId);
      expect(queued).not.toContain(unfit.topicId);
      return result;
    }

    it('skips a topic in a style the person did not choose', async () => {
      const w = await world();
      const unfit = await data.topic({
        style: 'history',
        interestId: w.interestId,
        story: true,
        audioVoiceIds: [w.voiceId],
      });
      await onlyControl(w, unfit);
    });

    it('skips a topic in an interest the person did not choose', async () => {
      const w = await world();
      const unfit = await data.topic({
        interestId: w.otherInterestId,
        story: true,
        audioVoiceIds: [w.voiceId],
      });
      await onlyControl(w, unfit);
    });

    it('never offers a NULL-interest pool topic, even with story and audio', async () => {
      const w = await world();
      const unfit = await data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
      await onlyControl(w, unfit);
    });

    it('queues the own proposed NULL-interest topic and creates no write_story job', async () => {
      const w = await world();
      const own = await data.topic({ interestId: null });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { withoutStory: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([own.topicId]);
      await expectNoStoryJobCreated(w.userId);
    });

    it('offers a pool topic that another person proposed, but not their story-less topic', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const shared = await ready(w);
      await data.userTopic(other, shared.topicId, 'proposed');
      const theirs = await data.topic({ interestId: w.interestId });
      await data.userTopic(other, theirs.topicId, 'proposed');
      await service.run(w.userId);
      const queued = await queuedTopics(w.userId);
      expect(queued).toContain(shared.topicId);
      expect(queued).not.toContain(theirs.topicId);
    });

    it('treats audio in another voice as no audio, not ready, and renders nothing', async () => {
      const w = await world();
      const t = await data.topic({
        interestId: w.interestId,
        story: true,
        audioVoiceIds: [w.otherVoiceId],
      });
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 0, withoutAudio: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([t.topicId]);
      await expectNoStoryJobCreated(w.userId);
    });
  });

  describe('exclusions', () => {
    async function excluded(
      prepare: (w: World, topic: { topicId: string; storyId: string | null }) => Promise<void>,
    ) {
      const w = await world();
      const unfit = await ready(w);
      await prepare(w, unfit);
      const control = await ready(w);
      await service.run(w.userId);
      const queued = await queuedTopics(w.userId);
      expect(queued).toContain(control.topicId);
      expect(queued).not.toContain(unfit.topicId);
    }

    it('does not queue a topic that is already in the queue a second time', async () => {
      const w = await world();
      const t = await ready(w);
      await data.queueItem(w.userId, t.topicId, 1);
      const control = await ready(w);
      await service.run(w.userId);
      const queued = await queuedTopics(w.userId);
      expect(queued.filter((id) => id === t.topicId)).toHaveLength(1);
      expect(queued).toContain(control.topicId);
      expect(queued).toHaveLength(2);
    });

    it('skips a topic the person dismissed', () =>
      excluded((w, t) => data.userTopic(w.userId, t.topicId, 'proposed', { dismissed: true })));

    it('skips a story the person has heard (any listens row)', () =>
      excluded((w, t) => data.listen(w.userId, t.storyId as string, w.voiceId)));

    it('skips a story the person rated -1', () =>
      excluded((w, t) => data.rating(w.userId, t.storyId as string, -1)));

    it('does not skip a story that ANOTHER person rated -1 or heard', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const t = await ready(w);
      await data.rating(other, t.storyId as string, -1);
      await data.listen(other, t.storyId as string, w.voiceId);
      await service.run(w.userId);
      expect(await queuedTopics(w.userId)).toEqual([t.topicId]);
    });

    it('does not skip a story the person rated +1', async () => {
      const w = await world();
      const t = await ready(w);
      await data.rating(w.userId, t.storyId as string, 1);
      await service.run(w.userId);
      expect(await queuedTopics(w.userId)).toEqual([t.topicId]);
    });
  });

  describe('privacy (SECURITY.md rule 10)', () => {
    it('never offers a topic another person requested, with story and audio and a matching interest', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const requested = await ready(w);
      await data.userTopic(other, requested.topicId, 'requested');
      const control = await ready(w);

      await service.run(w.userId);

      const queued = await queuedTopics(w.userId);
      expect(queued).toContain(control.topicId);
      expect(queued).not.toContain(requested.topicId);
    });

    it('never offers a requested topic that still lacks audio (no render job either)', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const requested = await lacksAudio(w);
      await data.userTopic(other, requested.topicId, 'requested');
      await service.run(w.userId);
      expect(await queuedTopics(w.userId)).not.toContain(requested.topicId);
      await expectNoStoryJobCreated(w.userId);
    });

    it('never offers another person\'s NULL-interest proposed topic with story and audio', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const theirs = await data.topic({ interestId: null, story: true, audioVoiceIds: [w.voiceId] });
      await data.userTopic(other, theirs.topicId, 'proposed');
      const control = await ready(w);

      await service.run(w.userId);

      const queued = await queuedTopics(w.userId);
      expect(queued).toContain(control.topicId);
      expect(queued).not.toContain(theirs.topicId);
    });
  });

  describe('limits', () => {
    it('is not limited by the generations of the day: it queues what it finds and starts nothing', async () => {
      const w = await world();
      await succeededGenerations(w.userId, 5);
      await data.job({ userId: w.userId, kind: 'write_story', status: 'running' });
      const r = await ready(w);
      for (let i = 0; i < 3; i++) await lacksAudio(w);
      const before = await idsOf(w.userId);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 1, withoutAudio: 2 }, queueLength: 3 });
      expect((await queuedTopics(w.userId))[0]).toBe(r.topicId);
      expect(await idsOf(w.userId)).toEqual(before);
    });

    it('creates a suggest_topics job for what is missing when the candidates run out', async () => {
      const w = await world();
      await ready(w);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 1 }, suggestRequested: true });
      const suggest = (await jobsOf(w.userId)).filter((j) => j.kind === 'suggest_topics');
      expect(suggest).toHaveLength(1);
      expect(suggest[0]?.payload).toEqual({ kind: 'suggest_topics', missing: 2 });
      expect(suggest[0]?.dedupeKey).toBe(`suggest_topics:${w.userId}`);
      await expectNoStoryJobCreated(w.userId);
    });

    it('blocks a new suggestion when 3 succeeded in the window, and counts only the window', async () => {
      const w = await world();
      for (let i = 0; i < 3; i++) {
        await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 2 });
      }
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ suggestRequested: false });
      expect(await jobsOf(w.userId)).toHaveLength(3);

      const v = await world();
      for (let i = 0; i < 3; i++) {
        await data.job({ userId: v.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 26 });
      }
      await expect(service.run(v.userId)).resolves.toMatchObject({ suggestRequested: true });
    });

    it('needs only a suggestion slot: all five generations used does not block a suggestion', async () => {
      const w = await world();
      await succeededGenerations(w.userId, 5);
      const before = await idsOf(w.userId);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ suggestRequested: true });
      const added = (await jobsOf(w.userId)).filter((j) => !before.has(j.id));
      expect(added.map((j) => j.kind)).toEqual(['suggest_topics']);
    });
  });

  describe('no story job in any source scenario (AGENTS.md architecture rule 10)', () => {
    it.each([
      ['ready stories', async (w: World) => { await ready(w); await ready(w); await ready(w); }],
      ['stories with no audio in the voice', async (w: World) => { for (let i = 0; i < 3; i++) await lacksAudio(w); }],
      [
        'the own proposed topics with no story',
        async (w: World) => {
          for (let i = 0; i < 3; i++) {
            const own = await data.topic({ interestId: w.interestId });
            await data.userTopic(w.userId, own.topicId, 'proposed');
          }
        },
      ],
      ['no candidates (only a suggestion)', async () => undefined],
      [
        'all three sources at once',
        async (w: World) => {
          await ready(w);
          await lacksAudio(w);
          const own = await data.topic({ interestId: w.interestId });
          await data.userTopic(w.userId, own.topicId, 'proposed');
        },
      ],
    ])('creates no write_story and no render_audio row for %s', async (_name, prepare) => {
      const w = await world();
      await prepare(w);
      const before = await idsOf(w.userId);
      await service.run(w.userId);
      await service.run(w.userId);
      await expectNoStoryJobCreated(w.userId, before);
      const kinds = (await jobsOf(w.userId)).map((j) => j.kind);
      expect(kinds.every((kind) => kind === 'suggest_topics')).toBe(true);
    });
  });

  describe('dedupe, idempotence and isolation', () => {
    it('queues the topic and makes no story job while another person writes it', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const theirs = await data.job({
        userId: other,
        kind: 'write_story',
        status: 'running',
        dedupeKey: `write_story:${own.topicId}`,
      });

      const result = await service.run(w.userId);

      expect(result).toMatchObject({ queued: { withoutStory: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([own.topicId]);
      const mine = await jobsOf(w.userId);
      // The other person's job is untouched.
      const stillTheirs = await prisma.generationJob.findUnique({ where: { id: theirs } });
      expect(stillTheirs).toMatchObject({ requestedByUserId: other, status: 'running' });
      expect(mine.map((j) => j.kind)).toEqual(['suggest_topics']);

      // The winner finishes with audio in the OTHER voice. The next run of the loser does
      // not render it: only an explicit start does (the stalled-items step is gone).
      await data.storyFor(own.topicId, [w.otherVoiceId]);
      await data.markJob(theirs, 'succeeded');
      enqueued.length = 0;
      await service.run(w.userId);
      await expectNoStoryJobCreated(w.userId);
      expect(enqueued).toEqual([]);
    });

    it('a second run creates nothing new', async () => {
      const w = await world();
      for (let i = 0; i < 3; i++) await ready(w);
      await service.run(w.userId);
      const items = await queueOf(w.userId);
      await expect(service.run(w.userId)).resolves.toEqual({ skipped: 'queue_full' });
      expect(await queueOf(w.userId)).toEqual(items);

      // With nothing to queue the suggestion job is the only one, and a repeat adds none.
      const v = await world();
      await service.run(v.userId);
      const first = await jobsOf(v.userId);
      expect(first.map((j) => j.kind)).toEqual(['suggest_topics']);
      await service.run(v.userId);
      expect(await jobsOf(v.userId)).toHaveLength(1);
    });

    it('never touches another person\'s queue or jobs', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const t = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(other, t.topicId, 4);
      await data.job({ userId: other, kind: 'render_audio', status: 'pending' });
      await data.job({ userId: other, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 1 });
      const snapshot = async () =>
        JSON.stringify({
          items: await prisma.queueItem.findMany({ where: { userId: other }, orderBy: { id: 'asc' } }),
          jobs: await prisma.generationJob.findMany({
            where: { requestedByUserId: other },
            orderBy: { id: 'asc' },
          }),
        });
      const before = await snapshot();
      for (let i = 0; i < 3; i++) await ready(w);
      await lacksAudio(w);
      await service.run(w.userId);
      expect(await snapshot()).toBe(before);
    });
  });

  describe('failed jobs', () => {
    it('does not queue a topic whose write_story finally failed, nor a story whose render failed', async () => {
      const w = await world();
      const failedWrite = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, failedWrite.topicId, 'proposed');
      await data.job({
        userId: w.userId,
        kind: 'write_story',
        status: 'failed',
        dedupeKey: `write_story:${failedWrite.topicId}`,
      });
      const failedRender = await lacksAudio(w);
      await data.job({
        userId: w.userId,
        kind: 'render_audio',
        status: 'failed',
        dedupeKey: `render_audio:${failedRender.storyId}:${w.voiceId}`,
      });
      const control = await ready(w);

      await service.run(w.userId);

      const queued = await queuedTopics(w.userId);
      expect(queued).toEqual([control.topicId]);
    });
  });

  describe('enqueue and concurrency', () => {
    it('hands the queue only the committed suggestion job', async () => {
      const w = await world();
      await lacksAudio(w);

      await service.run(w.userId);

      const rows = await jobsOf(w.userId);
      expect(rows.map((r) => r.kind)).toEqual(['suggest_topics']);
      expect(enqueued.map((e) => e.id)).toEqual(rows.map((r) => r.id));
      expect(enqueued.every((e) => e.visible)).toBe(true);
    });

    it('enqueues nothing when the run creates no job', async () => {
      const w = await world();
      await ready(w);
      await ready(w);
      await ready(w);
      await service.run(w.userId);
      expect(enqueued).toEqual([]);
    });

    it('two simultaneous runs for one person never exceed the queue, and create one suggestion at most', async () => {
      for (let round = 0; round < 5; round++) {
        const w = await world();
        for (let i = 0; i < 6; i++) await lacksAudio(w);
        for (let i = 0; i < 3; i++) {
          const own = await data.topic({ interestId: w.interestId });
          await data.userTopic(w.userId, own.topicId, 'proposed');
        }
        await succeededGenerations(w.userId, 3);

        await Promise.all([service.run(w.userId), service.run(w.userId)]);

        const queued = await queuedTopics(w.userId);
        expect(queued.length).toBeLessThanOrEqual(3);
        expect(new Set(queued).size).toBe(queued.length);
        const all = await jobsOf(w.userId);
        // Only the three seeded renders: the runs added no story job.
        expect(all.filter((j) => j.kind !== 'suggest_topics')).toHaveLength(3);
      }
    });
  });
});
