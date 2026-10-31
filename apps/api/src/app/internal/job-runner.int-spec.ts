import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { GenerationJobPayload, JobKind } from '@sleep-stories/contracts';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import type { Prisma } from '../../generated/prisma/client';
import { envFilePaths, validateEnv } from '../config/env';
import { dedupeKeyOf } from '../queue/generation-jobs.service';
import { findReady, findWithoutAudio, findWithoutStory } from '../queue/queue-candidates';
import { MAX_ATTEMPTS, SWEEP_BATCH_SIZE } from '../queue/queue-policy';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { LlmProviderError } from '../providers/llm/llm.provider';
import { TtsProviderError } from '../providers/tts/tts.provider';
import {
  JobHandlerRegistry,
  JobLeaseLostError,
  type JobContext,
  type JobHandler,
} from './job-handler';
import { JobRunnerService } from './job-runner.service';
import { JobSweeperService } from './job-sweeper.service';

// Runs against the REAL local database with the real PrismaModule. The handlers are fakes
// whose behaviour each test sets; no provider is ever called. Every test builds its own
// voice, interest, people and topics with random ids.
assertLocalDatabase();

const KINDS: JobKind[] = ['write_story', 'render_audio', 'suggest_topics'];
const FAKE_SECRET = 'sk-ant-FAKEKEY-0123456789 and the title Тайна старого маяка';

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let runner: JobRunnerService;

type Behaviour = (context: JobContext) => Promise<void>;
let behaviour: Partial<Record<JobKind, Behaviour>> = {};
let calls: { jobId: string; kind: JobKind; attempt: number }[] = [];
let logged: string[] = [];

// The default behaviour: write nothing and mark the job succeeded in its own transaction.
const succeed: Behaviour = async (context) => {
  await prisma.$transaction(async (tx) => {
    await context.markSucceeded(tx);
  });
};

const handlers: JobHandler[] = KINDS.map((kind) => ({
  kind,
  run: async (context) => {
    calls.push({ jobId: context.job.id, kind, attempt: context.job.attempt });
    await (behaviour[kind] ?? succeed)(context);
  },
}));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  data = new QueueTestData(prisma);
  runner = new JobRunnerService(prisma, new JobHandlerRegistry(handlers));
});

afterAll(async () => {
  await data.cleanup();
  await app.close();
});

beforeEach(() => {
  behaviour = {};
  calls = [];
  logged = [];
  // Everything the runner logs is captured (and kept out of the test output).
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One person with preferences, a topic with a story and a topic without one.
async function world() {
  const voiceId = await data.voice();
  const interestId = await data.interest();
  const userId = await data.user({ voiceId, interestIds: [interestId] });
  const withStory = await data.topic({ interestId, story: true });
  const bare = await data.topic({ interestId });
  return { voiceId, interestId, userId, withStory, bare };
}
type World = Awaited<ReturnType<typeof world>>;

function payloadFor(kind: JobKind, w: World): GenerationJobPayload {
  switch (kind) {
    case 'write_story':
      return { kind, topicId: w.bare.topicId, voiceId: w.voiceId };
    case 'render_audio':
      return { kind, storyId: w.withStory.storyId as string, voiceId: w.voiceId };
    case 'suggest_topics':
      return { kind, missing: 1 };
  }
}

async function makeJob(
  w: World,
  kind: JobKind,
  options: { status?: 'pending' | 'running' | 'succeeded' | 'failed'; attempts?: number } = {},
): Promise<string> {
  const payload = payloadFor(kind, w);
  return data.job({
    userId: w.userId,
    kind,
    status: options.status ?? 'pending',
    attempts: options.attempts,
    payload,
    dedupeKey: dedupeKeyOf(w.userId, payload),
  });
}

const readJob = (id: string) => prisma.generationJob.findUniqueOrThrow({ where: { id } });

async function backdate(
  jobId: string,
  minutes: { started?: number; created?: number },
): Promise<void> {
  if (minutes.started !== undefined) {
    await prisma.$executeRaw`
      UPDATE generation_jobs SET started_at = now() - make_interval(mins => ${minutes.started}::int)
      WHERE id = ${jobId}::uuid`;
  }
  if (minutes.created !== undefined) {
    await prisma.$executeRaw`
      UPDATE generation_jobs SET created_at = now() - make_interval(mins => ${minutes.created}::int)
      WHERE id = ${jobId}::uuid`;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const queuedTopics = async (userId: string) =>
  (await prisma.queueItem.findMany({ where: { userId }, select: { topicId: true } })).map(
    (i) => i.topicId,
  );

describe('JobRunnerService (database)', () => {
  describe('the claim', () => {
    it('runs the handler once under two concurrent deliveries (repeated)', async () => {
      behaviour.write_story = async (context) => {
        await sleep(80);
        await succeed(context);
      };
      for (let round = 0; round < 8; round++) {
        const w = await world();
        const jobId = await makeJob(w, 'write_story');

        const outcomes = await Promise.all([runner.run(jobId), runner.run(jobId)]);

        expect(calls.filter((c) => c.jobId === jobId)).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'succeeded')).toHaveLength(1);
        expect(outcomes.filter((o) => o !== 'succeeded')[0]).toMatch(/^(in_progress|finished)$/);
        const job = await readJob(jobId);
        expect(job).toMatchObject({ status: 'succeeded', attempts: 1, lastError: null });
        expect(job.finishedAt).not.toBeNull();
      }
    });

    it('answers in_progress for a fresh running job and does not call the handler', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story', { status: 'running', attempts: 1 });
      await expect(runner.run(jobId)).resolves.toBe('in_progress');
      expect(calls).toEqual([]);
      expect(await readJob(jobId)).toMatchObject({ status: 'running', attempts: 1 });
    });

    it('retakes a running job whose lease expired', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story', { status: 'running', attempts: 1 });
      await backdate(jobId, { started: 11 });
      await expect(runner.run(jobId)).resolves.toBe('succeeded');
      expect(calls).toEqual([{ jobId, kind: 'write_story', attempt: 2 }]);
      expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 2 });
    });

    it('answers finished for a succeeded, a failed and a missing job, without a handler', async () => {
      const w = await world();
      const done = await makeJob(w, 'write_story', { status: 'succeeded', attempts: 1 });
      const w2 = await world();
      const failed = await makeJob(w2, 'write_story', { status: 'failed', attempts: 3 });
      await expect(runner.run(done)).resolves.toBe('finished');
      await expect(runner.run(failed)).resolves.toBe('finished');
      await expect(runner.run('00000000-0000-4000-8000-0000000000bb')).resolves.toBe('finished');
      expect(calls).toEqual([]);
    });

    it('hands the handler the parsed job, the requester and the attempt number', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'render_audio');
      let seen: JobContext['job'] | undefined;
      behaviour.render_audio = async (context) => {
        seen = context.job;
        await succeed(context);
      };
      await runner.run(jobId);
      expect(seen).toEqual({
        id: jobId,
        kind: 'render_audio',
        userId: w.userId,
        payload: payloadFor('render_audio', w),
        attempt: 1,
      });
    });
  });

  describe('markSucceeded and the fence', () => {
    it('refuses a stale run: attempts moved on while the job is still running', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      let thrown: unknown;
      behaviour.write_story = async (context) => {
        // Another delivery takes the job over (what a second claim writes).
        await prisma.$executeRaw`
          UPDATE generation_jobs SET attempts = attempts + 1, started_at = now()
          WHERE id = ${jobId}::uuid`;
        try {
          await prisma.$transaction(async (tx) => {
            // A row the stale handler writes in the same transaction as its success.
            await tx.queueItem.create({
              data: { userId: w.userId, topicId: w.bare.topicId, position: 1 },
            });
            await context.markSucceeded(tx);
          });
        } catch (error) {
          thrown = error;
          throw error;
        }
      };

      await expect(runner.run(jobId)).resolves.toBe('finished');

      expect(thrown).toBeInstanceOf(JobLeaseLostError);
      // The job is the new owner's: still running, attempts as the takeover left it, and
      // the stale run neither succeeded nor failed it.
      expect(await readJob(jobId)).toMatchObject({
        status: 'running',
        attempts: 2,
        lastError: null,
        finishedAt: null,
      });
      // The stale handler's other write rolled back with the failed markSucceeded.
      expect(await queuedTopics(w.userId)).toEqual([]);
    });

    it('refuses a stale run whose job was retaken and finished by a newer run', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      let thrown: unknown;
      behaviour.write_story = async (context) => {
        if (context.job.attempt === 1) {
          await backdate(jobId, { started: 11 });
          await expect(runner.run(jobId)).resolves.toBe('succeeded');
          try {
            await prisma.$transaction(async (tx) => {
              await context.markSucceeded(tx);
            });
          } catch (error) {
            thrown = error;
            throw error;
          }
          return;
        }
        await succeed(context);
      };

      await expect(runner.run(jobId)).resolves.toBe('finished');

      expect(thrown).toBeInstanceOf(JobLeaseLostError);
      expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 2 });
      expect(calls.map((c) => c.attempt)).toEqual([1, 2]);
    });

    it('changes nothing when a stale run fails', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      await data.queueItem(w.userId, w.bare.topicId, 1);
      behaviour.write_story = async () => {
        await prisma.$executeRaw`
          UPDATE generation_jobs SET attempts = attempts + 1, started_at = now()
          WHERE id = ${jobId}::uuid`;
        throw new Error(FAKE_SECRET);
      };
      await expect(runner.run(jobId)).resolves.toBe('finished');
      expect(await readJob(jobId)).toMatchObject({ status: 'running', lastError: null });
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId]);
    });

    it('refuses a client that is not a transaction client', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      let thrown: unknown;
      behaviour.write_story = async (context) => {
        try {
          await context.markSucceeded(prisma as unknown as Prisma.TransactionClient);
        } catch (error) {
          thrown = error;
          throw error;
        }
      };
      await runner.run(jobId);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(JobLeaseLostError);
      expect((await readJob(jobId)).status).not.toBe('succeeded');
    });
  });

  describe('failures', () => {
    it.each([
      ['write_story', MAX_ATTEMPTS.write_story],
      ['render_audio', MAX_ATTEMPTS.render_audio],
      ['suggest_topics', MAX_ATTEMPTS.suggest_topics],
    ] as const)('%s: retries a retryable error and fails for good at attempt %d', async (kind, max) => {
      expect(max).toBe(kind === 'write_story' ? 3 : 2);
      const w = await world();
      const jobId = await makeJob(w, kind);
      behaviour[kind] = async () => {
        throw new LlmProviderError(true, 529);
      };

      for (let attempt = 1; attempt < max; attempt++) {
        await expect(runner.run(jobId)).resolves.toBe('retry');
        const job = await readJob(jobId);
        expect(job).toMatchObject({ status: 'pending', attempts: attempt, startedAt: null });
        expect(job.lastError).toBeNull();
      }
      await expect(runner.run(jobId)).resolves.toBe('failed');
      const job = await readJob(jobId);
      expect(job).toMatchObject({ status: 'failed', attempts: max, lastError: 'llm_error:529' });
      expect(job.finishedAt).not.toBeNull();

      await expect(runner.run(jobId)).resolves.toBe('finished');
      expect(calls).toHaveLength(max);
    });

    it('keeps the queue item while a retry is still possible', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      await data.queueItem(w.userId, w.bare.topicId, 1);
      behaviour.write_story = async () => {
        throw new TtsProviderError(true, 503);
      };
      await expect(runner.run(jobId)).resolves.toBe('retry');
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId]);
    });

    it('fails an error of an unknown type at once, with a code and no error text', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      behaviour.write_story = async () => {
        throw Object.assign(new Error(FAKE_SECRET), { retryable: true });
      };
      await expect(runner.run(jobId)).resolves.toBe('failed');
      const job = await readJob(jobId);
      expect(job).toMatchObject({ status: 'failed', attempts: 1, lastError: 'unknown' });
      expect(JSON.stringify(job)).not.toContain('FAKEKEY');
      expect(JSON.stringify(job)).not.toContain('маяка');
      expect(logged.join('\n')).not.toContain('FAKEKEY');
      expect(logged.join('\n')).not.toContain('маяка');
    });

    it('stores only the code of a provider error whose message holds a key and a title', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'render_audio');
      behaviour.render_audio = async () => {
        throw Object.assign(new TtsProviderError(false, 401), { message: FAKE_SECRET });
      };
      await expect(runner.run(jobId)).resolves.toBe('failed');
      const job = await readJob(jobId);
      expect(job.lastError).toBe('tts_error:401');
      expect(logged.join('\n')).not.toContain('FAKEKEY');
      expect(logged.join('\n')).not.toContain(jobId);
    });

    it('leaves the queue items of everyone in place when a write_story fails for good', async () => {
      const w = await world();
      const waiting = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const otherVoice = await data.voice();
      const waitingOtherVoice = await data.user({ voiceId: otherVoice });
      const bystander = await data.user({ voiceId: w.voiceId });
      const jobId = await makeJob(w, 'write_story');
      const unrelated = await data.topic({ interestId: w.interestId });
      await data.queueItem(w.userId, w.bare.topicId, 1);
      await data.queueItem(w.userId, unrelated.topicId, 2);
      await data.queueItem(waiting, w.bare.topicId, 1);
      await data.queueItem(waitingOtherVoice, w.bare.topicId, 1);
      await data.queueItem(bystander, unrelated.topicId, 1);
      behaviour.write_story = async () => {
        throw new Error('x');
      };

      await expect(runner.run(jobId)).resolves.toBe('failed');

      // Owner decision (2026-10-31): the item stays and shows the failed state; a retry is
      // an explicit start. Nothing is removed for anyone.
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId, unrelated.topicId]);
      expect(await queuedTopics(waiting)).toEqual([w.bare.topicId]);
      expect(await queuedTopics(waitingOtherVoice)).toEqual([w.bare.topicId]);
      expect(await queuedTopics(bystander)).toEqual([unrelated.topicId]);
      expect(await readJob(jobId)).toMatchObject({ status: 'failed', lastError: 'unknown' });
    });

    it('leaves the queue items in place when a render_audio fails for good', async () => {
      const w = await world();
      const sameVoice = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const otherVoice = await data.voice();
      const differentVoice = await data.user({ voiceId: otherVoice });
      const noPreferences = await data.user();
      const jobId = await makeJob(w, 'render_audio');
      const unrelated = await data.topic({ interestId: w.interestId, story: true });
      await data.queueItem(w.userId, w.withStory.topicId, 1);
      await data.queueItem(w.userId, unrelated.topicId, 2);
      await data.queueItem(sameVoice, w.withStory.topicId, 1);
      await data.queueItem(sameVoice, unrelated.topicId, 2);
      await data.queueItem(differentVoice, w.withStory.topicId, 1);
      await data.queueItem(noPreferences, w.withStory.topicId, 1);
      behaviour.render_audio = async () => {
        throw new Error('x');
      };

      await expect(runner.run(jobId)).resolves.toBe('failed');

      expect(await queuedTopics(w.userId)).toEqual([w.withStory.topicId, unrelated.topicId]);
      expect(await queuedTopics(sameVoice)).toEqual([w.withStory.topicId, unrelated.topicId]);
      expect(await queuedTopics(differentVoice)).toEqual([w.withStory.topicId]);
      expect(await queuedTopics(noPreferences)).toEqual([w.withStory.topicId]);
    });

    it('leaves the waiting items in place when the requester was deleted', async () => {
      const w = await world();
      const waiting = await data.user({ voiceId: w.voiceId });
      const jobId = await makeJob(w, 'write_story');
      await data.queueItem(waiting, w.bare.topicId, 1);
      await prisma.$executeRaw`UPDATE generation_jobs SET requested_by_user_id = NULL WHERE id = ${jobId}::uuid`;
      behaviour.write_story = async () => {
        throw new Error('x');
      };
      await expect(runner.run(jobId)).resolves.toBe('failed');
      expect(await queuedTopics(waiting)).toEqual([w.bare.topicId]);
    });

    it('leaves the queue alone when a suggest_topics fails for good', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'suggest_topics');
      await data.queueItem(w.userId, w.bare.topicId, 1);
      behaviour.suggest_topics = async () => {
        throw new Error('x');
      };
      await expect(runner.run(jobId)).resolves.toBe('failed');
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId]);
    });

    it('fails a handler that returns without marking the job', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      behaviour.write_story = async () => undefined;
      await expect(runner.run(jobId)).resolves.toBe('failed');
      expect(await readJob(jobId)).toMatchObject({
        status: 'failed',
        lastError: 'handler_did_not_complete',
      });
    });

    it('answers retry and touches nothing for a job whose kind has no registered handler', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story');
      await data.queueItem(w.userId, w.bare.topicId, 1);
      const bare = new JobRunnerService(prisma, new JobHandlerRegistry());
      await expect(bare.run(jobId)).resolves.toBe('retry');
      // No attempt counted, no failure, no queue change, nothing handled.
      expect(await readJob(jobId)).toMatchObject({
        status: 'pending',
        attempts: 0,
        startedAt: null,
        lastError: null,
      });
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId]);
      expect(calls).toEqual([]);
      // A finished job is still reported as finished, handler or not.
      const done = await makeJob(w, 'render_audio', { status: 'succeeded' });
      await expect(bare.run(done)).resolves.toBe('finished');
    });

    it('fails an invalid payload and a payload that disagrees with the kind', async () => {
      const w = await world();
      const broken = await data.job({
        userId: w.userId,
        kind: 'write_story',
        status: 'pending',
        payload: { kind: 'write_story' },
      });
      await expect(runner.run(broken)).resolves.toBe('failed');
      expect(await readJob(broken)).toMatchObject({
        status: 'failed',
        lastError: 'invalid_payload',
      });

      const w2 = await world();
      const mismatch = await data.job({
        userId: w2.userId,
        kind: 'write_story',
        status: 'pending',
        payload: { kind: 'suggest_topics', missing: 1 },
      });
      await expect(runner.run(mismatch)).resolves.toBe('failed');
      expect((await readJob(mismatch)).lastError).toBe('invalid_payload');
      expect(calls).toEqual([]);
    });

    it('closes a job whose last attempt crashed once its lease expired', async () => {
      const w = await world();
      const jobId = await makeJob(w, 'write_story', {
        status: 'running',
        attempts: MAX_ATTEMPTS.write_story,
      });
      await data.queueItem(w.userId, w.bare.topicId, 1);

      // Fresh lease: the last attempt may still be running.
      await expect(runner.run(jobId)).resolves.toBe('in_progress');
      expect((await readJob(jobId)).status).toBe('running');

      await backdate(jobId, { started: 11 });
      await expect(runner.run(jobId)).resolves.toBe('failed');
      expect(await readJob(jobId)).toMatchObject({
        status: 'failed',
        lastError: 'attempts_exhausted',
        attempts: MAX_ATTEMPTS.write_story,
      });
      expect(await queuedTopics(w.userId)).toEqual([w.bare.topicId]);
      expect(calls).toEqual([]);
    });
  });

  describe('failed jobs and the candidate finders', () => {
    const query = (userId: string, voiceId: string) => ({ userId, voiceId, limit: 20 });

    it('offers a topic with a failed write_story job to nobody, and an unrelated topic still', async () => {
      const w = await world();
      const other = await data.user({ voiceId: w.voiceId, interestIds: [w.interestId] });
      const readyBad = await data.topic({
        interestId: w.interestId,
        story: true,
        audioVoiceIds: [w.voiceId],
      });
      const readyGood = await data.topic({
        interestId: w.interestId,
        story: true,
        audioVoiceIds: [w.voiceId],
      });
      const renderBad = await data.topic({ interestId: w.interestId, story: true });
      const renderGood = await data.topic({ interestId: w.interestId, story: true });
      const writeBad = await data.topic({ interestId: w.interestId });
      const writeGood = await data.topic({ interestId: w.interestId });
      for (const t of [writeBad, writeGood]) {
        await data.userTopic(w.userId, t.topicId, 'proposed');
      }
      for (const t of [readyBad, renderBad, writeBad]) {
        await data.job({
          userId: other,
          kind: 'write_story',
          status: 'failed',
          dedupeKey: `write_story:${t.topicId}`,
        });
      }

      const found = await prisma.$transaction(async (tx) => ({
        ready: (await findReady(tx, query(w.userId, w.voiceId))).map((c) => c.topicId),
        otherReady: (await findReady(tx, query(other, w.voiceId))).map((c) => c.topicId),
        rendering: (await findWithoutAudio(tx, query(w.userId, w.voiceId))).map((c) => c.topicId),
        otherRendering: (await findWithoutAudio(tx, query(other, w.voiceId))).map((c) => c.topicId),
        writing: await findWithoutStory(tx, query(w.userId, w.voiceId)),
      }));

      expect(found.ready).toContain(readyGood.topicId);
      expect(found.ready).not.toContain(readyBad.topicId);
      expect(found.otherReady).toContain(readyGood.topicId);
      expect(found.otherReady).not.toContain(readyBad.topicId);
      expect(found.rendering).toContain(renderGood.topicId);
      expect(found.rendering).not.toContain(renderBad.topicId);
      expect(found.otherRendering).toContain(renderGood.topicId);
      expect(found.otherRendering).not.toContain(renderBad.topicId);
      expect(found.writing).toContain(writeGood.topicId);
      expect(found.writing).not.toContain(writeBad.topicId);
    });

    it('does not offer a story whose render for this voice failed, but offers it for another voice', async () => {
      const w = await world();
      const otherVoice = await data.voice();
      const sameInterestUser = await data.user({ voiceId: otherVoice, interestIds: [w.interestId] });
      const failedRender = await data.topic({ interestId: w.interestId, story: true });
      const control = await data.topic({ interestId: w.interestId, story: true });
      await data.job({
        userId: w.userId,
        kind: 'render_audio',
        status: 'failed',
        dedupeKey: `render_audio:${failedRender.storyId}:${w.voiceId}`,
      });

      const found = await prisma.$transaction(async (tx) => ({
        mine: (await findWithoutAudio(tx, query(w.userId, w.voiceId))).map((c) => c.topicId),
        theirs: (await findWithoutAudio(tx, query(sameInterestUser, otherVoice))).map(
          (c) => c.topicId,
        ),
      }));

      expect(found.mine).toContain(control.topicId);
      expect(found.mine).not.toContain(failedRender.topicId);
      expect(found.theirs).toContain(failedRender.topicId);
    });

    it('still offers a topic whose earlier jobs only succeeded', async () => {
      const w = await world();
      const topic = await data.topic({ interestId: w.interestId, story: true });
      await data.job({
        userId: w.userId,
        kind: 'write_story',
        status: 'succeeded',
        dedupeKey: `write_story:${topic.topicId}`,
      });
      const found = await prisma.$transaction((tx) => findWithoutAudio(tx, query(w.userId, w.voiceId)));
      expect(found.map((c) => c.topicId)).toContain(topic.topicId);
    });
  });
});

describe('JobSweeperService (database)', () => {
  class RecordingQueue extends JobQueue {
    readonly ids: string[] = [];
    failOn: string | null = null;
    async enqueue(jobId: string): Promise<void> {
      this.ids.push(jobId);
      if (jobId === this.failOn) {
        throw new Error(FAKE_SECRET);
      }
    }
  }

  it('picks old pending and expired running jobs, ignores the rest, and changes no row', async () => {
    const w = await world();
    const w2 = await world();
    const w3 = await world();
    const w4 = await world();
    const oldPending = await makeJob(w, 'write_story');
    await backdate(oldPending, { created: 3 });
    const freshPending = await makeJob(w2, 'write_story');
    const expiredRunning = await makeJob(w3, 'write_story', { status: 'running', attempts: 1 });
    await backdate(expiredRunning, { started: 11, created: 12 });
    const freshRunning = await makeJob(w4, 'write_story', { status: 'running', attempts: 1 });
    const w5 = await world();
    const oldSucceeded = await makeJob(w5, 'write_story', { status: 'succeeded', attempts: 1 });
    await backdate(oldSucceeded, { created: 60 });
    const w6 = await world();
    const oldFailed = await makeJob(w6, 'write_story', { status: 'failed', attempts: 3 });
    await backdate(oldFailed, { created: 60, started: 60 });
    const mine = [oldPending, freshPending, expiredRunning, freshRunning, oldSucceeded, oldFailed];
    const before = await prisma.generationJob.findMany({ where: { id: { in: mine } } });

    const queue = new RecordingQueue();
    const result = await new JobSweeperService(prisma, queue).sweep();

    expect(queue.ids).toContain(oldPending);
    expect(queue.ids).toContain(expiredRunning);
    for (const id of [freshPending, freshRunning, oldSucceeded, oldFailed]) {
      expect(queue.ids).not.toContain(id);
    }
    expect(result.enqueued).toBe(queue.ids.length);
    const after = await prisma.generationJob.findMany({ where: { id: { in: mine } } });
    const byId = (rows: typeof before) => rows.sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(after)).toEqual(byId(before));
  });

  it('enqueues at most the batch size per call', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < SWEEP_BATCH_SIZE + 5; i++) {
      const id = await data.job({ userId: w.userId, kind: 'write_story', status: 'pending' });
      await backdate(id, { created: 5 });
      ids.push(id);
    }
    try {
      const queue = new RecordingQueue();
      const result = await new JobSweeperService(prisma, queue).sweep();
      expect(result.enqueued).toBe(SWEEP_BATCH_SIZE);
      expect(queue.ids).toHaveLength(SWEEP_BATCH_SIZE);
    } finally {
      // Left in place these old pending rows would crowd out later sweeps in this file.
      await prisma.generationJob.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('counts out an enqueue that throws, keeps going, and logs nothing', async () => {
    const w = await world();
    const a = await makeJob(w, 'write_story');
    // Oldest first, so it is inside the batch whatever else is pending.
    await backdate(a, { created: 1_000_000 });
    const queue = new RecordingQueue();
    queue.failOn = a;
    const result = await new JobSweeperService(prisma, queue).sweep();
    expect(queue.ids).toContain(a);
    expect(result.enqueued).toBe(queue.ids.length - 1);
    expect(logged).toEqual([]);
  });
});
