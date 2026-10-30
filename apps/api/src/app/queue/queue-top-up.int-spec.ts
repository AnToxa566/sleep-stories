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
const newJobsOf = async (userId: string, before: Set<string>) =>
  (await jobsOf(userId)).filter((job) => !before.has(job.id));

async function succeededRenders(userId: string, count: number, hoursAgo = 1) {
  for (let i = 0; i < count; i++) {
    await data.job({ userId, kind: 'render_audio', status: 'succeeded', hoursAgo });
  }
}

describe('QueueTopUpService (database)', () => {
  describe('sources and queue length', () => {
    it('appends after the existing positions, ready before rendering', async () => {
      const w = await world();
      const r = await ready(w);
      const d = await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const old = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(w.userId, old.topicId, 7);

      const result = await service.run(w.userId);

      expect(result).toMatchObject({ queued: { ready: 1, rendering: 1, writing: 0 } });
      expect(await queueOf(w.userId)).toEqual([
        { topicId: old.topicId, position: 7 },
        { topicId: r.topicId, position: 8 },
        { topicId: d.topicId, position: 9 },
      ]);
      // The queue held 1 item, so only 2 were needed: the writing topic stays out.
      expect(result).toMatchObject({ queueLength: 3 });
    });

    it('fills an empty queue with ready, rendering and writing in order, positions 1..3', async () => {
      const w = await world();
      const r = await ready(w);
      const d = await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');

      const result = await service.run(w.userId);

      expect(result).toMatchObject({ queued: { ready: 1, rendering: 1, writing: 1 }, queueLength: 3 });
      expect(await queueOf(w.userId)).toEqual([
        { topicId: r.topicId, position: 1 },
        { topicId: d.topicId, position: 2 },
        { topicId: own.topicId, position: 3 },
      ]);
      const jobs = await jobsOf(w.userId);
      expect(jobs.map((j) => j.kind).sort()).toEqual(['render_audio', 'write_story']);
      expect(jobs.find((j) => j.kind === 'render_audio')?.payload).toEqual({
        kind: 'render_audio',
        storyId: d.storyId,
        voiceId: w.voiceId,
      });
      expect(jobs.find((j) => j.kind === 'write_story')?.payload).toEqual({
        kind: 'write_story',
        topicId: own.topicId,
        voiceId: w.voiceId,
      });
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
      await expect(service.run(w.userId)).resolves.toEqual({ skipped: 'queue_full', healed: 0 });
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

    it('queues the own proposed NULL-interest topic with a write_story job', async () => {
      const w = await world();
      const own = await data.topic({ interestId: null });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { writing: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([own.topicId]);
      const writes = (await jobsOf(w.userId)).filter((j) => j.kind === 'write_story');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.payload).toEqual({
        kind: 'write_story',
        topicId: own.topicId,
        voiceId: w.voiceId,
      });
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

    it('treats audio in another voice as rendering, not ready', async () => {
      const w = await world();
      const t = await data.topic({
        interestId: w.interestId,
        story: true,
        audioVoiceIds: [w.otherVoiceId],
      });
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 0, rendering: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([t.topicId]);
      const jobs = await jobsOf(w.userId);
      expect(jobs.filter((j) => j.kind === 'render_audio')).toHaveLength(1);
      expect(jobs[0]?.payload).toEqual({
        kind: 'render_audio',
        storyId: t.storyId,
        voiceId: w.voiceId,
      });
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
      const renders = (await jobsOf(w.userId)).filter((j) => j.kind === 'render_audio');
      expect(renders).toEqual([]);
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
    const renderJobs = async (userId: string, before: Set<string>) =>
      (await newJobsOf(userId, before)).filter((j) => j.kind === 'render_audio');
    const idsOf = async (userId: string) => new Set((await jobsOf(userId)).map((j) => j.id));

    it('allows exactly one render when 4 succeeded in the window and none is active', async () => {
      const w = await world();
      await succeededRenders(w.userId, 4);
      for (let i = 0; i < 3; i++) await lacksAudio(w);
      const before = await idsOf(w.userId);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { rendering: 1 }, suggestRequested: false, limitReached: true });
      expect(await renderJobs(w.userId, before)).toHaveLength(1);
      expect(await newJobsOf(w.userId, before)).toHaveLength(1);
    });

    it('queues ready stories but starts no job when 4 succeeded and 1 is pending', async () => {
      const w = await world();
      await succeededRenders(w.userId, 4);
      await data.job({ userId: w.userId, kind: 'render_audio', status: 'pending' });
      const r = await ready(w);
      await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const before = await idsOf(w.userId);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 1, rendering: 0, writing: 0 }, limitReached: true });
      expect(await queuedTopics(w.userId)).toEqual([r.topicId]);
      expect(await newJobsOf(w.userId, before)).toEqual([]);
    });

    it('starts nothing when 3 succeeded and 2 are active (a running write counts)', async () => {
      const w = await world();
      await succeededRenders(w.userId, 3);
      await data.job({ userId: w.userId, kind: 'write_story', status: 'running' });
      await data.job({ userId: w.userId, kind: 'render_audio', status: 'pending' });
      await lacksAudio(w);
      const before = await idsOf(w.userId);
      await service.run(w.userId);
      expect(await queueOf(w.userId)).toEqual([]);
      expect(await newJobsOf(w.userId, before)).toEqual([]);
    });

    it('does not count a render finished 25 hours ago', async () => {
      const w = await world();
      await succeededRenders(w.userId, 5, 25);
      for (let i = 0; i < 3; i++) await lacksAudio(w);
      const before = await idsOf(w.userId);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { rendering: 3 } });
      expect(await renderJobs(w.userId, before)).toHaveLength(3);
    });

    it('counts a render finished 23 hours ago', async () => {
      const w = await world();
      await succeededRenders(w.userId, 4, 23);
      await succeededRenders(w.userId, 1, 25);
      for (let i = 0; i < 3; i++) await lacksAudio(w);
      const before = await idsOf(w.userId);
      await service.run(w.userId);
      expect(await renderJobs(w.userId, before)).toHaveLength(1);
    });

    it('frees the slot of a failed job', async () => {
      const w = await world();
      await succeededRenders(w.userId, 3);
      await data.job({ userId: w.userId, kind: 'render_audio', status: 'failed' });
      await data.job({ userId: w.userId, kind: 'write_story', status: 'failed' });
      for (let i = 0; i < 3; i++) await lacksAudio(w);
      const before = await idsOf(w.userId);
      await service.run(w.userId);
      expect(await renderJobs(w.userId, before)).toHaveLength(2);
    });

    it('creates a suggest_topics job for what is missing when the candidates run out', async () => {
      const w = await world();
      await ready(w);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ queued: { ready: 1 }, suggestRequested: true, limitReached: false });
      const suggest = (await jobsOf(w.userId)).filter((j) => j.kind === 'suggest_topics');
      expect(suggest).toHaveLength(1);
      expect(suggest[0]?.payload).toEqual({ kind: 'suggest_topics', missing: 2 });
      expect(suggest[0]?.dedupeKey).toBe(`suggest_topics:${w.userId}`);
    });

    it('blocks a new suggestion when 3 succeeded in the window, and counts only the window', async () => {
      const w = await world();
      for (let i = 0; i < 3; i++) {
        await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 2 });
      }
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ suggestRequested: false, limitReached: true });
      expect(await jobsOf(w.userId)).toHaveLength(3);

      const v = await world();
      for (let i = 0; i < 3; i++) {
        await data.job({ userId: v.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 26 });
      }
      await expect(service.run(v.userId)).resolves.toMatchObject({ suggestRequested: true });
    });

    it('starts no suggestion when no render slot is left', async () => {
      const w = await world();
      await succeededRenders(w.userId, 5);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ suggestRequested: false, limitReached: true });
      expect((await jobsOf(w.userId)).filter((j) => j.kind === 'suggest_topics')).toEqual([]);
    });
  });

  describe('dedupe, idempotence and isolation', () => {
    it('queues the topic but makes no job and uses no slot when another person already writes it', async () => {
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

      expect(result).toMatchObject({ queued: { writing: 1 } });
      expect(await queuedTopics(w.userId)).toEqual([own.topicId]);
      const mine = await jobsOf(w.userId);
      expect(mine.filter((j) => j.kind === 'write_story')).toEqual([]);
      // The other person's job is untouched.
      const stillTheirs = await prisma.generationJob.findUnique({ where: { id: theirs } });
      expect(stillTheirs).toMatchObject({ requestedByUserId: other, status: 'running' });
      // No render slot was used: the only job of this person is a suggestion for the rest.
      expect(mine.map((j) => j.kind)).toEqual(['suggest_topics']);

      // The winner finishes: the story exists, but its audio is in the OTHER voice. The
      // loser's next run renders it in the loser's voice, once.
      const storyId = await data.storyFor(own.topicId, [w.otherVoiceId]);
      await data.markJob(theirs, 'succeeded');
      enqueued.length = 0;
      const again = await service.run(w.userId);
      expect(again).toMatchObject({ healed: 1 });
      const renders = (await jobsOf(w.userId)).filter((j) => j.kind === 'render_audio');
      expect(renders).toHaveLength(1);
      expect(renders[0]?.dedupeKey).toBe(`render_audio:${storyId}:${w.voiceId}`);
      expect(renders[0]?.payload).toEqual({ kind: 'render_audio', storyId, voiceId: w.voiceId });
      expect(enqueued.filter((e) => e.id === renders[0]?.id)).toHaveLength(1);
    });

    it('a second run creates nothing new', async () => {
      const w = await world();
      for (let i = 0; i < 3; i++) await ready(w);
      await service.run(w.userId);
      const items = await queueOf(w.userId);
      await expect(service.run(w.userId)).resolves.toEqual({ skipped: 'queue_full', healed: 0 });
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

  describe('stalled queue items', () => {
    // A queue item whose topic has a story but no audio in the person's voice.
    async function stalledItem(w: World, position = 1) {
      const t = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(w.userId, t.topicId, position);
      return { topicId: t.topicId, storyId: t.storyId as string };
    }
    const renderJobsOf = async (userId: string) =>
      (await jobsOf(userId)).filter((j) => j.kind === 'render_audio');

    it('heals even when the queue already holds 3, and enqueues the job once', async () => {
      const w = await world();
      const item = await stalledItem(w, 1);
      for (const position of [2, 3]) {
        const t = await ready(w);
        await data.queueItem(w.userId, t.topicId, position);
      }
      const result = await service.run(w.userId);
      expect(result).toEqual({ skipped: 'queue_full', healed: 1 });
      const renders = await renderJobsOf(w.userId);
      expect(renders).toHaveLength(1);
      expect(renders[0]?.dedupeKey).toBe(`render_audio:${item.storyId}:${w.voiceId}`);
      expect(enqueued.map((e) => e.id)).toEqual([renders[0]?.id]);
      expect(enqueued[0]?.visible).toBe(true);
      expect(await queueOf(w.userId)).toHaveLength(3);
    });

    it('creates no job while an active render of the same story and voice exists (another person)', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const item = await stalledItem(w);
      await data.job({
        userId: other,
        kind: 'render_audio',
        status: 'running',
        dedupeKey: `render_audio:${item.storyId}:${w.voiceId}`,
      });
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ healed: 0 });
      expect(await renderJobsOf(w.userId)).toEqual([]);
    });

    it('creates no job when audio in the person\'s voice already exists', async () => {
      const w = await world();
      const t = await data.topic({ interestId: w.interestId, story: true, audioVoiceIds: [w.voiceId] });
      await data.queueItem(w.userId, t.topicId, 1);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ healed: 0 });
      expect(await renderJobsOf(w.userId)).toEqual([]);
    });

    it('does not retry a failed render, nor one that succeeded without audio (any status), also when full', async () => {
      const w = await world();
      const failed = await stalledItem(w, 1);
      const failedJob = await data.job({
        userId: w.userId,
        kind: 'render_audio',
        status: 'running',
        dedupeKey: `render_audio:${failed.storyId}:${w.voiceId}`,
      });
      await data.markJob(failedJob, 'failed');
      const done = await stalledItem(w, 2);
      await data.job({
        userId: w.userId,
        kind: 'render_audio',
        status: 'succeeded',
        dedupeKey: `render_audio:${done.storyId}:${w.voiceId}`,
      });
      const third = await ready(w);
      await data.queueItem(w.userId, third.topicId, 3);

      const before = new Set((await jobsOf(w.userId)).map((j) => j.id));
      // Full queue.
      expect(await service.run(w.userId)).toEqual({ skipped: 'queue_full', healed: 0 });
      expect(await newJobsOf(w.userId, before)).toEqual([]);
      // Not full: drop one item, then run again.
      await prisma.queueItem.deleteMany({ where: { userId: w.userId, topicId: third.topicId } });
      expect(await service.run(w.userId)).toMatchObject({ healed: 0 });
      expect(await renderJobsOf(w.userId)).toHaveLength(2);
      expect(enqueued).toEqual([]);
    });

    it('does not heal a stalled item whose story the person has heard', async () => {
      const w = await world();
      const item = await stalledItem(w);
      await data.listen(w.userId, item.storyId, w.voiceId);
      expect(await service.run(w.userId)).toMatchObject({ healed: 0 });
      expect(await renderJobsOf(w.userId)).toEqual([]);
    });

    it('respects the daily limit: nothing is created and the item stays', async () => {
      const w = await world();
      await succeededRenders(w.userId, 5);
      const item = await stalledItem(w);
      const result = await service.run(w.userId);
      expect(result).toMatchObject({ healed: 0 });
      expect((await jobsOf(w.userId)).filter((j) => j.status === 'pending')).toEqual([]);
      expect(await queuedTopics(w.userId)).toEqual([item.topicId]);
    });

    it('looks only at the person\'s own queue', async () => {
      const w = await world();
      const otherVoice = await data.voice();
      const other = await data.user({ voiceId: otherVoice, interestIds: [w.interestId] });
      const theirs = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(other, theirs.topicId, 1);
      // Requested by them, so it is not in the pool for the first person either.
      await data.userTopic(other, theirs.topicId, 'requested');
      await service.run(w.userId);
      expect(await jobsOf(other)).toEqual([]);
      expect(await renderJobsOf(w.userId)).toEqual([]);
    });

    it('a second run right after healing creates nothing more', async () => {
      const w = await world();
      await stalledItem(w);
      await service.run(w.userId);
      const afterFirst = await jobsOf(w.userId);
      enqueued.length = 0;
      const second = await service.run(w.userId);
      expect(second).toMatchObject({ healed: 0 });
      expect(await jobsOf(w.userId)).toHaveLength(afterFirst.length);
      expect(enqueued).toEqual([]);
    });
  });

  describe('enqueue and concurrency', () => {
    it('hands the queue only committed ids of jobs that exist, and only the created ones', async () => {
      const w = await world();
      await lacksAudio(w);
      const own = await data.topic({ interestId: w.interestId });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      await data.job({
        userId: other,
        kind: 'write_story',
        status: 'pending',
        dedupeKey: `write_story:${own.topicId}`,
      });

      await service.run(w.userId);

      const rows = await jobsOf(w.userId);
      expect(rows.length).toBeGreaterThan(0);
      expect(enqueued.map((e) => e.id).sort()).toEqual(rows.map((r) => r.id).sort());
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

    it('two simultaneous runs for one person never exceed the queue or the slots', async () => {
      for (let round = 0; round < 5; round++) {
        const w = await world();
        for (let i = 0; i < 6; i++) await lacksAudio(w);
        for (let i = 0; i < 3; i++) {
          const own = await data.topic({ interestId: w.interestId });
          await data.userTopic(w.userId, own.topicId, 'proposed');
        }
        await succeededRenders(w.userId, 3);

        await Promise.all([service.run(w.userId), service.run(w.userId)]);

        const queued = await queuedTopics(w.userId);
        expect(queued.length).toBeLessThanOrEqual(3);
        expect(new Set(queued).size).toBe(queued.length);
        const active = (await jobsOf(w.userId)).filter(
          (j) => (j.kind === 'render_audio' || j.kind === 'write_story') && j.status === 'pending',
        );
        // 5 slots - 3 used = 2 at most, and never a job beyond the queue.
        expect(active.length).toBeLessThanOrEqual(2);
        expect(active.length).toBeLessThanOrEqual(queued.length);
      }
    });
  });
});
