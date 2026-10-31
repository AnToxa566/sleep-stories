import { randomUUID } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { z } from 'zod';
import { assertLocalDatabase } from '../../../test-support/assert-local-database';
import { QueueTestData } from '../../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../../config/env';
import { TopicSuggesterService } from '../../generation/topic-suggester.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { JobQueue } from '../../providers/job-queue/job-queue';
import { LlmProvider, LlmProviderError } from '../../providers/llm/llm.provider';
import type {
  GenerateStructuredInput,
  GenerateStructuredResult,
} from '../../providers/llm/llm.provider';
import { ProvidersModule } from '../../providers/providers.module';
import { GenerationJobsService } from '../../queue/generation-jobs.service';
import { GenerationLimitsService } from '../../queue/generation-limits.service';
import { QueueModule } from '../../queue/queue.module';
import { QueueTopUpService } from '../../queue/queue-top-up.service';
import { JobHandlerRegistry, type JobHandler } from '../job-handler';
import { JobRunnerService } from '../job-runner.service';
import { SuggestTopicsHandler } from './suggest-topics.handler';
import type { Prisma } from '../../../generated/prisma/client';

// Runs against the REAL local database with the real PrismaModule and QueueModule and the
// REAL TopicSuggesterService over a fake model that records every call. The job queue is a
// recording fake. No provider is ever called. Every test builds its own voice, interests and
// people with random ids; the topics the handler stores carry a unique title prefix so they
// can be found and removed.
assertLocalDatabase();

const PREFIX = `sgt-${randomUUID().slice(0, 8)}-`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RecordedCall {
  system: string;
  user: string;
  // What the fake model answered: title and interest slug of each topic, and the titles of
  // the ones the service must drop (an interest slug that was not offered).
  replies: { title: string; interest: string | null }[];
  dropped: string[];
}

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let topUp: QueueTopUpService;
let suggester: TopicSuggesterService;
let jobsService: GenerationJobsService;
let limits: GenerationLimitsService;
let jobQueue: JobQueue;
let handler: SuggestTopicsHandler;
let runner: JobRunnerService;

const userIds: string[] = [];
let llmCalls: RecordedCall[] = [];
let failOnCall: number | null = null;
// A catalogue slug the fake model answers for topics made from typed interests.
let baitSlug = '';
let logged: string[] = [];
const enqueued: { id: string; visible: boolean }[] = [];

function block(user: string, tag: string): string {
  return user.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0] ?? '';
}

// The fake model: two topics per offered catalogue interest; for typed interests three topics
// with no interest and one that answers a catalogue slug the call did not offer.
function fakeModel(user: string): RecordedCall['replies'] {
  const slugs = block(user, 'interests')
    .split('\n')
    .filter((line) => line !== '(нет)' && line !== '')
    .map((line) => line.split(': ')[0]);
  const replies: RecordedCall['replies'] = [];
  for (const slug of slugs) {
    for (let i = 0; i < 2; i += 1) {
      replies.push({ title: `${PREFIX}${randomUUID()}`, interest: slug });
    }
  }
  if (block(user, 'custom_interests') !== '(нет)') {
    for (let i = 0; i < 3; i += 1) {
      replies.push({ title: `${PREFIX}c-${randomUUID()}`, interest: null });
    }
    replies.push({ title: `${PREFIX}bait-${randomUUID()}`, interest: baitSlug });
  }
  return replies;
}

const fakeLlm: LlmProvider = {
  generateText: () => Promise.reject(new Error('not used')),
  async generateStructured<S extends z.ZodType>(
    input: GenerateStructuredInput<S>,
  ): Promise<GenerateStructuredResult<S>> {
    const index = llmCalls.length;
    const replies = fakeModel(input.user);
    llmCalls.push({
      system: input.system,
      user: input.user,
      replies,
      dropped: replies.filter((r) => r.title.startsWith(`${PREFIX}bait-`)).map((r) => r.title),
    });
    if (failOnCall === index) {
      throw new LlmProviderError(true, 503);
    }
    const topics = replies.map((r) => ({ title: r.title, style: 'facts', interest: r.interest }));
    return { value: input.schema.parse({ topics }), model: 'fake-model' };
  },
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
      ProvidersModule,
      QueueModule,
    ],
    providers: [TopicSuggesterService, SuggestTopicsHandler],
  })
    .overrideProvider(LlmProvider)
    .useValue(fakeLlm)
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
  data = new QueueTestData(prisma);
  topUp = app.get(QueueTopUpService);
  suggester = app.get(TopicSuggesterService);
  jobsService = app.get(GenerationJobsService);
  limits = app.get(GenerationLimitsService);
  jobQueue = app.get(JobQueue);
  handler = app.get(SuggestTopicsHandler);
  runner = runnerFor(handler);
});

afterAll(async () => {
  // The topics the handler stored reference the test interests (RESTRICT) and are
  // referenced by user_topics and queue_items (RESTRICT), so: jobs, people, topics, rest.
  await prisma.generationJob.deleteMany({ where: { requestedByUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.topic.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await data.cleanup();
  await app.close();
});

beforeEach(() => {
  llmCalls = [];
  failOnCall = null;
  logged = [];
  enqueued.length = 0;
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A handler for one kind is not assignable to the wide JobHandler type (the parameter
// position is contravariant), hence the cast.
function runnerFor(h: JobHandler<'suggest_topics'>): JobRunnerService {
  return new JobRunnerService(prisma, new JobHandlerRegistry([h] as unknown as JobHandler[]));
}

// A person with preferences, `interests` catalogue interests and the given typed interests.
async function world(options: { interests?: number; custom?: string[]; prefs?: boolean } = {}) {
  const voiceId = await data.voice();
  const interestIds: string[] = [];
  for (let i = 0; i < (options.interests ?? 2); i += 1) {
    interestIds.push(await data.interest());
  }
  const userId = await data.user({
    voiceId: options.prefs === false ? undefined : voiceId,
    interestIds,
  });
  userIds.push(userId);
  const interests = await prisma.interest.findMany({ where: { id: { in: interestIds } } });
  const slugs = interests.map((i) => i.slug);
  baitSlug = slugs[0] ?? 'unoffered-slug';
  const custom = options.custom ?? [];
  if (custom.length > 0) {
    await prisma.userCustomInterest.createMany({
      data: custom.map((title) => ({ userId, title })),
    });
  }
  return { voiceId, interestIds, slugs, userId, custom, interests };
}
type World = Awaited<ReturnType<typeof world>>;

async function suggestJob(w: World, missing = 3): Promise<string> {
  return data.job({
    userId: w.userId,
    kind: 'suggest_topics',
    status: 'pending',
    payload: { kind: 'suggest_topics', missing },
    dedupeKey: `suggest_topics:${w.userId}`,
  });
}

async function usedRenders(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await data.job({ userId, kind: 'render_audio', status: 'succeeded', hoursAgo: 1 });
  }
}

const readJob = (id: string) => prisma.generationJob.findUniqueOrThrow({ where: { id } });
const topicsOf = (userId: string) =>
  prisma.userTopic.findMany({ where: { userId }, include: { topic: true } });
const queueOf = (userId: string) =>
  prisma.queueItem.findMany({ where: { userId }, orderBy: { position: 'asc' } });
const writeJobsOf = (userId: string) =>
  prisma.generationJob.findMany({ where: { requestedByUserId: userId, kind: 'write_story' } });
const topicIdOf = (job: { payload: Prisma.JsonValue }) =>
  (job.payload as { topicId: string }).topicId;
const allReplies = () => llmCalls.flatMap((c) => c.replies);

async function expectNothingPersisted(userId: string): Promise<void> {
  expect(await topicsOf(userId)).toEqual([]);
  expect(await queueOf(userId)).toEqual([]);
  expect(await writeJobsOf(userId)).toEqual([]);
  const titles = allReplies().map((r) => r.title);
  expect(await prisma.topic.count({ where: { title: { in: titles } } })).toBe(0);
  expect(enqueued).toEqual([]);
}

// A queued topic must have a pending write_story job, and every write job must belong to a
// queued topic: a queued item with no job could never become ready.
async function expectQueuedTopicsHaveJobs(userId: string, voiceId?: string): Promise<void> {
  const queue = await queueOf(userId);
  const jobs = await writeJobsOf(userId);
  expect(new Set(queue.map((q) => q.topicId))).toEqual(new Set(jobs.map(topicIdOf)));
  expect(queue).toHaveLength(jobs.length);
  for (const job of jobs) {
    expect(job.status).toBe('pending');
    if (voiceId !== undefined) {
      expect((job.payload as { voiceId: string }).voiceId).toBe(voiceId);
    }
  }
}

describe('SuggestTopicsHandler (database)', () => {
  describe('the result', () => {
    it('stores topics and proposed user_topics and queues the missing ones with jobs', async () => {
      const w = await world();
      const jobId = await suggestJob(w, 3);

      await expect(runner.run(jobId)).resolves.toBe('succeeded');

      expect(llmCalls).toHaveLength(1);
      const stored = await topicsOf(w.userId);
      expect(stored).toHaveLength(4);
      const interestBySlug = new Map(w.interests.map((i) => [i.slug, i.id]));
      const slugByTitle = new Map(llmCalls[0].replies.map((r) => [r.title, r.interest]));
      for (const row of stored) {
        expect(row.reason).toBe('proposed');
        expect(row.dismissedAt).toBeNull();
        expect(row.topic.style).toBe('facts');
        const slug = slugByTitle.get(row.topic.title) as string;
        expect(row.topic.interestId).toBe(interestBySlug.get(slug));
      }

      const queue = await queueOf(w.userId);
      expect(queue.map((q) => q.position)).toEqual([1, 2, 3]);
      await expectQueuedTopicsHaveJobs(w.userId, w.voiceId);
      expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', lastError: null });

      // Handed to the queue after the commit: every row was visible by then.
      const writeJobs = await writeJobsOf(w.userId);
      expect(enqueued.map((e) => e.id).sort()).toEqual(writeJobs.map((j) => j.id).sort());
      expect(enqueued.every((e) => e.visible)).toBe(true);
      // No title or model text in any log line.
      expect(logged.join('')).not.toContain(PREFIX);
    });

    it('queues at most the number asked for', async () => {
      const w = await world();
      await expect(runner.run(await suggestJob(w, 1))).resolves.toBe('succeeded');
      expect(await topicsOf(w.userId)).toHaveLength(4);
      expect(await queueOf(w.userId)).toHaveLength(1);
      await expectQueuedTopicsHaveJobs(w.userId, w.voiceId);
    });

    it('queues one topic and one job when 4 of 5 renders are used', async () => {
      const w = await world();
      await usedRenders(w.userId, 4);

      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      expect(await topicsOf(w.userId)).toHaveLength(4);
      expect(await queueOf(w.userId)).toHaveLength(1);
      expect(await writeJobsOf(w.userId)).toHaveLength(1);
      await expectQueuedTopicsHaveJobs(w.userId, w.voiceId);
    });

    it('queues one more topic when two items are already queued', async () => {
      const w = await world();
      for (const position of [1, 2]) {
        const { topicId } = await data.topic({ interestId: w.interestIds[0], story: true });
        await data.queueItem(w.userId, topicId, position);
      }

      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      const queue = await queueOf(w.userId);
      expect(queue.map((q) => q.position)).toEqual([1, 2, 3]);
      expect(await writeJobsOf(w.userId)).toHaveLength(1);
      const newItem = queue[2];
      expect((await writeJobsOf(w.userId)).map(topicIdOf)).toEqual([newItem.topicId]);
    });

    it('stores the topics but queues nothing when no render slot is left', async () => {
      const w = await world();
      const jobId = await suggestJob(w, 3);
      await usedRenders(w.userId, 5);

      await expect(runner.run(jobId)).resolves.toBe('succeeded');

      expect(await topicsOf(w.userId)).toHaveLength(4);
      expect(await queueOf(w.userId)).toEqual([]);
      expect(await writeJobsOf(w.userId)).toEqual([]);
      expect(await readJob(jobId)).toMatchObject({ status: 'succeeded' });
      expect(enqueued).toEqual([]);
    });

    it('queues only topics whose job was created', async () => {
      const w = await world();
      const jobId = await suggestJob(w, 3);
      // A job service that "finds an active job" for the first item of every batch.
      const dropFirst = {
        createInKeyOrder: (tx: Prisma.TransactionClient, userId: string, items: never[]) =>
          jobsService.createInKeyOrder(tx, userId, items.slice(1)),
      } as unknown as GenerationJobsService;
      const partial = new SuggestTopicsHandler(prisma, suggester, dropFirst, limits, jobQueue);

      await expect(runnerFor(partial).run(jobId)).resolves.toBe('succeeded');

      expect(await queueOf(w.userId)).toHaveLength(2);
      expect(await writeJobsOf(w.userId)).toHaveLength(2);
      await expectQueuedTopicsHaveJobs(w.userId, w.voiceId);
      expect(await topicsOf(w.userId)).toHaveLength(4);
    });
  });

  describe('privacy of typed interests', () => {
    const custom = [`secret-${randomUUID()}`, `hidden-${randomUUID()}`];

    it('keeps typed text out of call A and catalogue interests out of call B', async () => {
      const w = await world({ custom });

      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      expect(llmCalls).toHaveLength(2);
      const [a, b] = llmCalls;
      // Call A: catalogue interests only, custom block empty, no typed text anywhere.
      for (const text of custom) {
        expect(a.user).not.toContain(text);
        expect(a.system).not.toContain(text);
      }
      expect(block(a.user, 'custom_interests')).toBe('(нет)');
      for (const slug of w.slugs) expect(a.user).toContain(slug);
      // Call B: typed interests only, interests block empty, no catalogue slug or title.
      for (const text of custom) expect(b.user).toContain(text);
      expect(block(b.user, 'interests')).toBe('(нет)');
      for (const slug of w.slugs) expect(b.user).not.toContain(slug);
      for (const interest of w.interests) expect(b.user).not.toContain(interest.title);
      // B is told not to repeat A.
      for (const reply of a.replies) expect(b.user).toContain(reply.title);
      expect(logged.join('')).not.toContain(custom[0]);
    });

    it('stores every topic of the typed-interest call with a NULL interest', async () => {
      const w = await world({ custom });

      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      const [a, b] = llmCalls;
      const stored = new Map((await topicsOf(w.userId)).map((r) => [r.topic.title, r.topic]));
      // The model answered a catalogue slug for one topic of call B; it must not be stored
      // with that interest (the service drops it, and nothing may store it otherwise).
      expect(b.dropped).toHaveLength(1);
      expect(stored.has(b.dropped[0])).toBe(false);
      const fromB = b.replies.filter((r) => !b.dropped.includes(r.title));
      expect(fromB.length).toBeGreaterThan(0);
      for (const reply of fromB) {
        expect(stored.get(reply.title)).toBeDefined();
        expect(stored.get(reply.title)?.interestId).toBeNull();
      }
      for (const reply of a.replies) {
        expect(stored.get(reply.title)?.interestId).not.toBeNull();
      }
      expect(stored.size).toBe(a.replies.length + fromB.length);
    });

    it('makes exactly one call for a person without typed interests', async () => {
      const w = await world();
      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');
      expect(llmCalls).toHaveLength(1);
    });

    it('makes one call for typed interests only without a catalogue interest', async () => {
      const w = await world({ interests: 0, custom });
      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');
      expect(llmCalls).toHaveLength(1);
      expect(block(llmCalls[0].user, 'interests')).toBe('(нет)');
      const stored = await topicsOf(w.userId);
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.every((row) => row.topic.interestId === null)).toBe(true);
    });
  });

  describe('what the model is told not to repeat', () => {
    const custom = [`secret-${randomUUID()}`];

    // A person with history: an ordinary catalogue topic, a topic grown from typed interests
    // (NULL interest), a catalogue topic that the person requested by typing, and one that
    // another person requested. Only the first may be named in call A.
    async function withHistory() {
      const w = await world({ custom });
      const other = await data.user();
      userIds.push(other);
      const titleOf = async (topicId: string) =>
        (await prisma.topic.findUniqueOrThrow({ where: { id: topicId } })).title;
      const ordinary = await data.topic({ interestId: w.interestIds[0] });
      const typed = await data.topic({ interestId: null });
      const requested = await data.topic({ interestId: w.interestIds[0] });
      const requestedByOther = await data.topic({ interestId: w.interestIds[0] });
      await data.userTopic(w.userId, ordinary.topicId, 'proposed');
      await data.userTopic(w.userId, typed.topicId, 'proposed');
      await data.userTopic(w.userId, requested.topicId, 'requested');
      await data.userTopic(w.userId, requestedByOther.topicId, 'proposed');
      await data.userTopic(other, requestedByOther.topicId, 'requested');
      return {
        w,
        ordinary: await titleOf(ordinary.topicId),
        hidden: [
          await titleOf(typed.topicId),
          await titleOf(requested.topicId),
          await titleOf(requestedByOther.topicId),
        ],
      };
    }

    it('keeps typed and NULL-interest titles out of call A and gives call B the whole history', async () => {
      const { w, ordinary, hidden } = await withHistory();

      await expect(runner.run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      expect(llmCalls).toHaveLength(2);
      const [a, b] = llmCalls;
      expect(block(a.user, 'existing_topics')).toContain(ordinary);
      for (const title of hidden) expect(a.user).not.toContain(title);
      // Call B de-duplicates the person's own words: everything, and call A's new titles.
      expect(block(b.user, 'existing_topics')).toContain(ordinary);
      for (const title of hidden) expect(b.user).toContain(title);
      for (const reply of a.replies) expect(b.user).toContain(reply.title);
    });
  });

  describe('the NULL layer of the handler itself', () => {
    it('stores a call B topic with a NULL interest even if the suggester returns a catalogue slug', async () => {
      // A suggester that does not filter: the real one drops a slug that was not offered and
      // would hide a handler that stored the model's interest.
      const w = await world({ custom: [`secret-${randomUUID()}`] });
      const calls: { custom: number }[] = [];
      const stub = {
        suggest: async (input: { customInterests: readonly string[] }) => {
          calls.push({ custom: input.customInterests.length });
          const typed = input.customInterests.length > 0;
          return {
            topics: [
              {
                title: `${PREFIX}${typed ? 'stub-b' : 'stub-a'}-${randomUUID()}`,
                style: 'facts' as const,
                interest: w.slugs[0],
              },
            ],
            model: 'stub',
            promptVersion: 'stub',
          };
        },
      } as unknown as TopicSuggesterService;
      const stubbed = new SuggestTopicsHandler(prisma, stub, jobsService, limits, jobQueue);

      await expect(runnerFor(stubbed).run(await suggestJob(w, 3))).resolves.toBe('succeeded');

      expect(calls.map((c) => c.custom > 0)).toEqual([false, true]);
      const stored = await topicsOf(w.userId);
      const fromB = stored.filter((row) => row.topic.title.includes('stub-b-'));
      const fromA = stored.filter((row) => row.topic.title.includes('stub-a-'));
      expect(fromB).toHaveLength(1);
      expect(fromB[0].topic.interestId).toBeNull();
      expect(fromA).toHaveLength(1);
      expect(fromA[0].topic.interestId).not.toBeNull();
    });
  });

  describe('missing targets', () => {
    it('fails for good when the person has no preferences', async () => {
      const w = await world({ prefs: false });
      const jobId = await suggestJob(w, 3);

      await expect(runner.run(jobId)).resolves.toBe('failed');

      expect(await readJob(jobId)).toMatchObject({
        status: 'failed',
        lastError: 'generation:job_target_missing',
      });
      expect(llmCalls).toEqual([]);
    });

    it('fails for good when the person has no interests at all', async () => {
      const w = await world({ interests: 0 });
      const jobId = await suggestJob(w, 3);

      await expect(runner.run(jobId)).resolves.toBe('failed');

      expect(await readJob(jobId)).toMatchObject({
        status: 'failed',
        lastError: 'generation:job_target_missing',
      });
      expect(llmCalls).toEqual([]);
    });

    it('fails for good when the requester is gone', async () => {
      const row = await prisma.generationJob.create({
        data: {
          kind: 'suggest_topics',
          payload: { kind: 'suggest_topics', missing: 3 },
          dedupeKey: `test:${randomUUID()}`,
          requestedByUserId: null,
        },
        select: { id: true },
      });
      try {
        await expect(runner.run(row.id)).resolves.toBe('failed');
        expect(await readJob(row.id)).toMatchObject({ lastError: 'generation:job_target_missing' });
      } finally {
        await prisma.generationJob.delete({ where: { id: row.id } });
      }
    });
  });

  describe('atomicity', () => {
    it('persists nothing when the lease was lost before the commit', async () => {
      const w = await world();
      const jobId = await suggestJob(w, 3);
      // Another run takes the job over while this one is still writing: its attempt number
      // no longer matches, so markSucceeded throws and the whole transaction rolls back.
      const stolen: JobHandler<'suggest_topics'> = {
        kind: 'suggest_topics',
        run: (ctx) =>
          handler.run({
            ...ctx,
            markSucceeded: async (tx) => {
              await prisma.$executeRaw`
                UPDATE generation_jobs SET attempts = attempts + 1, started_at = now()
                WHERE id = ${jobId}::uuid`;
              await ctx.markSucceeded(tx);
            },
          }),
      };

      await expect(runnerFor(stolen).run(jobId)).resolves.toBe('finished');

      await expectNothingPersisted(w.userId);
      expect(await readJob(jobId)).toMatchObject({ status: 'running', attempts: 2 });
    });

    it('persists nothing and asks for a retry when call B fails', async () => {
      const w = await world({ custom: [`secret-${randomUUID()}`] });
      const jobId = await suggestJob(w, 3);
      failOnCall = 1;

      await expect(runner.run(jobId)).resolves.toBe('retry');

      expect(llmCalls).toHaveLength(2);
      await expectNothingPersisted(w.userId);
      expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 1 });
    });
  });

  describe('concurrency with the top-up', () => {
    // One render slot left, one own proposed topic the top-up wants to write, and a
    // suggestion job that wants the same slot. The users-row lock must make them take turns.
    async function slotWorld() {
      const w = await world({ interests: 1 });
      await usedRenders(w.userId, 4);
      const own = await data.topic({ interestId: w.interestIds[0] });
      await data.userTopic(w.userId, own.topicId, 'proposed');
      return { w, jobId: await suggestJob(w, 3) };
    }

    async function expectOneSlotUsed(userId: string): Promise<void> {
      const active = await prisma.generationJob.findMany({
        where: {
          requestedByUserId: userId,
          kind: { in: ['write_story', 'render_audio'] },
          status: { in: ['pending', 'running'] },
        },
      });
      expect(active).toHaveLength(1);
      const queue = await queueOf(userId);
      const topicIds = queue.map((q) => q.topicId);
      expect(new Set(topicIds).size).toBe(topicIds.length);
      // Every queued topic has its job, and the single job belongs to a queued topic.
      expect(topicIds.sort()).toEqual((await writeJobsOf(userId)).map(topicIdOf).sort());
    }

    it('lets the top-up wait while the suggestion holds the lock, then sees its job', async () => {
      for (let round = 0; round < 3; round += 1) {
        const { w, jobId } = await slotWorld();
        // The handler pauses right after it read the limits, inside its transaction. The
        // top-up starts only then, so without the lock it would commit in that window.
        let entered!: () => void;
        const inside = new Promise<void>((resolve) => (entered = resolve));
        const slowLimits = {
          usage: async (tx: Prisma.TransactionClient, userId: string) => {
            const usage = await limits.usage(tx, userId);
            entered();
            await sleep(400);
            return usage;
          },
        } as unknown as GenerationLimitsService;
        const slow = new SuggestTopicsHandler(prisma, suggester, jobsService, slowLimits, jobQueue);

        const [outcome] = await Promise.all([
          runnerFor(slow).run(jobId),
          inside.then(() => topUp.run(w.userId)),
        ]);

        expect(outcome).toBe('succeeded');
        await expectOneSlotUsed(w.userId);
      }
    });

    it('never uses more than the one slot when both start together (repeated)', async () => {
      for (let round = 0; round < 6; round += 1) {
        const { w, jobId } = await slotWorld();

        const [, outcome] = await Promise.all([topUp.run(w.userId), runner.run(jobId)]);

        expect(outcome).toBe('succeeded');
        await expectOneSlotUsed(w.userId);
      }
    });
  });
});
