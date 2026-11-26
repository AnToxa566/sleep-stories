import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GenerationJobPayloadSchema } from '@sleep-stories/contracts';
import { assertLocalDatabase } from '../../../test-support/assert-local-database';
import { QueueTestData } from '../../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../../platform/config/env';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { JobQueue } from '../../providers/job-queue/job-queue';
import { ProvidersModule } from '../../providers/providers.module';
import { TopicsModule } from '../topics.module';
import { TopicSuggestService } from './topic-suggest.service';

// Runs against the REAL local database with the real PrismaModule and TopicsModule. The job
// queue is a recording fake, so nothing is dispatched and no model is called. Every test
// builds its own voice, interests and people with random ids.
assertLocalDatabase();

// For each enqueue call: the id and whether the job row was visible to a separate connection
// at that moment (visible means the transaction had committed).
const enqueued: { id: string; visible: boolean }[] = [];
let failEnqueue = false;

let app: INestApplication;
let prisma: PrismaService;
let service: TopicSuggestService;
let data: QueueTestData;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
      ProvidersModule,
      TopicsModule,
    ],
  })
    .overrideProvider(JobQueue)
    .useValue({
      enqueue: async (id: string) => {
        if (failEnqueue) {
          throw new Error('queue down');
        }
        const row = await prisma.generationJob.findUnique({ where: { id }, select: { id: true } });
        enqueued.push({ id, visible: row !== null });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  service = app.get(TopicSuggestService);
  data = new QueueTestData(prisma);
});

afterAll(async () => {
  await data.cleanup();
  await app.close();
});

beforeEach(() => {
  enqueued.length = 0;
  failEnqueue = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A person with styles facts and history, two catalogue interests and one typed interest.
async function world() {
  const voiceId = await data.voice();
  const interestIds = [await data.interest(), await data.interest()];
  const userId = await data.user({ voiceId, styles: ['facts', 'history'], interestIds });
  const slugs = (
    await prisma.interest.findMany({ where: { id: { in: interestIds } }, select: { id: true, slug: true } })
  ).sort((a, b) => interestIds.indexOf(a.id) - interestIds.indexOf(b.id))
    .map((row) => row.slug);
  const custom = await prisma.userCustomInterest.create({
    data: { userId, title: 'кошки' },
    select: { id: true },
  });
  return { voiceId, interestIds, slugs, userId, customId: custom.id };
}
type World = Awaited<ReturnType<typeof world>>;

const jobsOf = (userId: string) =>
  prisma.generationJob.findMany({ where: { requestedByUserId: userId }, orderBy: { createdAt: 'asc' } });

async function usedSuggestions(userId: string, hoursAgo: number[]): Promise<void> {
  for (const hours of hoursAgo) {
    await data.job({ userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: hours });
  }
}

function body(w: World, overrides: Partial<{ styles: ('facts' | 'history' | 'fairy_tale')[]; interestSlugs: string[]; customInterests: string[] }> = {}) {
  return {
    styles: ['facts' as const],
    interestSlugs: [w.slugs[0]],
    customInterests: ['кошки'],
    ...overrides,
  };
}

async function expectRefused(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, response: { statusCode: status, code } });
}

describe('TopicSuggestService (database)', () => {
  describe('start', () => {
    it('creates one requested suggest_topics job with row ids, enqueues it after the commit', async () => {
      const w = await world();
      const answer = await service.start(w.userId, body(w));

      const jobs = await jobsOf(w.userId);
      expect(jobs).toHaveLength(1);
      const [job] = jobs;
      expect(job).toMatchObject({
        kind: 'suggest_topics',
        status: 'pending',
        dedupeKey: `suggest_topics:${w.userId}`,
      });
      expect(GenerationJobPayloadSchema.parse(job.payload)).toEqual({
        kind: 'suggest_topics',
        missing: 0,
        selection: { styles: ['facts'], interestIds: [w.interestIds[0]], customInterestIds: [w.customId] },
      });
      // The typed text itself never enters the job row.
      expect(JSON.stringify(job.payload)).not.toContain('кошки');
      expect(enqueued).toEqual([{ id: job.id, visible: true }]);

      expect(answer).toEqual({
        latest: { id: job.id, state: 'running' },
        suggestions: { left: 4, limit: 5, nextAt: null },
      });
    });

    it('creates no story or audio job and no queue item', async () => {
      const w = await world();
      await service.start(w.userId, body(w));
      expect((await jobsOf(w.userId)).map((j) => j.kind)).toEqual(['suggest_topics']);
      expect(await prisma.queueItem.count({ where: { userId: w.userId } })).toBe(0);
    });

    it('still answers when the enqueue fails; the row stays pending for the sweep', async () => {
      const w = await world();
      failEnqueue = true;
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const answer = await service.start(w.userId, body(w));
      expect(answer.latest?.state).toBe('running');
      expect((await jobsOf(w.userId)).map((j) => j.status)).toEqual(['pending']);
    });

    it.each([
      ['a style the person did not choose', { styles: ['fairy_tale' as const] }, 'validation_failed'],
      ['a catalogue interest the person did not choose', { interestSlugs: ['not-chosen'] }, 'unknown_interest'],
      ['a typed interest the person does not have', { customInterests: ['собаки'] }, 'unknown_interest'],
    ])('refuses %s with 400 and writes nothing', async (_name, overrides, code) => {
      const w = await world();
      await expectRefused(service.start(w.userId, body(w, overrides)), 400, code);
      expect(await jobsOf(w.userId)).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    it('refuses another person’s typed interest', async () => {
      const w = await world();
      const other = await world();
      await prisma.userCustomInterest.create({ data: { userId: other.userId, title: 'тайна' } });
      await expectRefused(
        service.start(w.userId, body(w, { customInterests: ['тайна'] })),
        400,
        'unknown_interest',
      );
      expect(await jobsOf(w.userId)).toEqual([]);
    });

    it('refuses a person without onboarding', async () => {
      const userId = await data.user();
      await expectRefused(
        service.start(userId, { styles: ['facts'], interestSlugs: ['x'], customInterests: [] }),
        400,
        'validation_failed',
      );
    });

    it('answers 409 while a suggestion of the person is pending or running, also a top-up one', async () => {
      const w = await world();
      await data.job({
        userId: w.userId,
        kind: 'suggest_topics',
        status: 'running',
        payload: { kind: 'suggest_topics', missing: 2 },
        dedupeKey: `suggest_topics:${w.userId}`,
      });
      await expectRefused(service.start(w.userId, body(w)), 409, 'suggestion_in_progress');
      expect(await jobsOf(w.userId)).toHaveLength(1);
    });

    it('answers 429 when the five suggestions of the window are used, and counts only the window', async () => {
      const w = await world();
      await usedSuggestions(w.userId, [1, 2, 3, 4, 5]);
      await expectRefused(service.start(w.userId, body(w)), 429, 'suggestion_limit_reached');
      expect(await jobsOf(w.userId)).toHaveLength(5);

      const v = await world();
      await usedSuggestions(v.userId, [1, 2, 3, 4, 26]);
      await expect(service.start(v.userId, body(v))).resolves.toMatchObject({
        suggestions: { left: 0 },
      });
    });

    it('lets only one of two simultaneous taps through', async () => {
      const w = await world();
      const results = await Promise.allSettled([
        service.start(w.userId, body(w)),
        service.start(w.userId, body(w)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toMatchObject({ reason: { status: 409 } });
      expect(await jobsOf(w.userId)).toHaveLength(1);
    });
  });

  describe('status', () => {
    it('has no latest suggestion and a full cap for a new person', async () => {
      const w = await world();
      await expect(service.status(w.userId)).resolves.toEqual({
        latest: null,
        suggestions: { left: 5, limit: 5, nextAt: null },
      });
    });

    it('reports the newest suggestion, whoever started it, and a failed one as failed', async () => {
      const w = await world();
      await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'succeeded', hoursAgo: 3 });
      const failed = await data.job({ userId: w.userId, kind: 'suggest_topics', status: 'failed' });
      const answer = await service.status(w.userId);
      expect(answer.latest).toEqual({ id: failed, state: 'failed' });
      // A failed suggestion is returned to the cap.
      expect(answer.suggestions.left).toBe(4);
    });

    it('is scoped to the person', async () => {
      const w = await world();
      const other = await world();
      await data.job({ userId: other.userId, kind: 'suggest_topics', status: 'running' });
      await expect(service.status(w.userId)).resolves.toMatchObject({ latest: null });
    });

    it('gives the time the oldest counted suggestion leaves the window when none is left', async () => {
      const w = await world();
      await usedSuggestions(w.userId, [2, 3, 4, 5, 6]);
      const oldest = await prisma.generationJob.aggregate({
        where: { requestedByUserId: w.userId },
        _min: { finishedAt: true },
      });
      const expected = new Date((oldest._min.finishedAt as Date).getTime() + 24 * 3_600_000);
      const answer = await service.status(w.userId);
      expect(answer.suggestions).toEqual({ left: 0, limit: 5, nextAt: expected.toISOString() });
    });
  });
});
