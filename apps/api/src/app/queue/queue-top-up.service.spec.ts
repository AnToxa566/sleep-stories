import type { PrismaService } from '../prisma/prisma.service';
import type { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService } from './generation-jobs.service';
import type { GenerationLimitsService } from './generation-limits.service';
import { findReady, findWithoutAudio, findWithoutStory } from './queue-candidates';
import { QueueTopUpService } from './queue-top-up.service';

jest.mock('./queue-candidates');

// Control flow only: the SQL is proven by the integration spec. Every collaborator is a fake.
const USER = '11111111-1111-4111-8111-111111111111';
const VOICE = '22222222-2222-4222-8222-222222222222';
const topic = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const story = (n: number) => `99999999-0000-4000-8000-00000000000${n}`;

interface Setup {
  userRows?: unknown[];
  preferences?: { voiceId: string } | null;
  queueLength?: number;
  usage?: { generationsUsed: number; suggestionsUsed: number };
  ready?: { topicId: string; storyId: string }[];
  withoutAudio?: { topicId: string; storyId: string }[];
  withoutStory?: string[];
  // Decides the id a job insert returns; null means an active job with that key exists.
  createResult?: (spec: { payload: { kind: string; topicId?: string; storyId?: string } }) => string | null;
  enqueue?: jest.Mock;
}

const defaultId: NonNullable<Setup['createResult']> = (spec) =>
  `job-${spec.payload.kind}-${spec.payload.topicId ?? spec.payload.storyId ?? 'x'}`;

function build(setup: Setup = {}) {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => setup.userRows ?? [{ id: USER }]),
    userPreference: {
      findUnique: jest.fn(async () =>
        setup.preferences === undefined ? { voiceId: VOICE } : setup.preferences,
      ),
    },
    queueItem: {
      count: jest.fn(async () => setup.queueLength ?? 0),
      aggregate: jest.fn(async () => ({ _max: { position: 4 } })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => {
      const value = await callback(tx);
      events.push('commit');
      return value;
    }),
  } as unknown as PrismaService;
  const limits = {
    usage: jest.fn(async () => setup.usage ?? { generationsUsed: 0, suggestionsUsed: 0 }),
  } as unknown as GenerationLimitsService;
  const create = jest.fn(async (_tx: unknown, spec: Parameters<NonNullable<Setup['createResult']>>[0]) =>
    (setup.createResult ?? defaultId)(spec),
  );
  // The real key-ordered creation, with only the insert stubbed.
  const jobs = Object.assign(new GenerationJobsService(), { create });
  const enqueue =
    setup.enqueue ??
    jest.fn(async (id: string) => {
      events.push(`enqueue:${id}`);
    });
  const jobQueue = { enqueue } as unknown as JobQueue;

  (findReady as jest.Mock).mockResolvedValue(setup.ready ?? []);
  (findWithoutAudio as jest.Mock).mockResolvedValue(setup.withoutAudio ?? []);
  (findWithoutStory as jest.Mock).mockResolvedValue(setup.withoutStory ?? []);

  const service = new QueueTopUpService(prisma, limits, jobs, jobQueue);
  return { service, tx, create, enqueue, events, limits };
}

describe('QueueTopUpService.run', () => {
  beforeEach(() => jest.clearAllMocks());

  // The rule (AGENTS.md architecture rule 10): a top-up never creates a story job.
  const kindsCreated = (create: jest.Mock) =>
    create.mock.calls.map(([, spec]) => (spec as { payload: { kind: string } }).payload.kind);

  it('skips with no_preferences when the user row does not exist', async () => {
    const { service, create, tx } = build({ userRows: [] });
    await expect(service.run(USER)).resolves.toEqual({ skipped: 'no_preferences' });
    expect(tx.userPreference.findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('skips with no_preferences when the person has no preferences', async () => {
    const { service, create, tx } = build({ preferences: null });
    await expect(service.run(USER)).resolves.toEqual({ skipped: 'no_preferences' });
    expect(tx.queueItem.createMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('skips with queue_full when the queue is above the threshold', async () => {
    const { service, create, enqueue, tx } = build({ queueLength: 3 });
    await expect(service.run(USER)).resolves.toEqual({ skipped: 'queue_full' });
    expect(findReady).not.toHaveBeenCalled();
    expect(tx.queueItem.createMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues the sources in order, appends positions and creates no job', async () => {
    const { service, tx, create, enqueue } = build({
      ready: [{ topicId: topic(1), storyId: story(1) }],
      withoutAudio: [{ topicId: topic(2), storyId: story(2) }],
      withoutStory: [topic(3)],
    });
    const result = await service.run(USER);
    expect(result).toEqual({
      queued: { ready: 1, withoutAudio: 1, withoutStory: 1 },
      suggestRequested: false,
      queueLength: 3,
    });
    expect(tx.queueItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER, topicId: topic(1), position: 5 },
        { userId: USER, topicId: topic(2), position: 6 },
        { userId: USER, topicId: topic(3), position: 7 },
      ],
      skipDuplicates: true,
    });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('asks for suggestions when nothing fits and reports it', async () => {
    const { service, create } = build({ queueLength: 1 });
    const result = await service.run(USER);
    expect(result).toEqual({
      queued: { ready: 0, withoutAudio: 0, withoutStory: 0 },
      suggestRequested: true,
      queueLength: 1,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      userId: USER,
      payload: { kind: 'suggest_topics', missing: 2 },
    });
  });

  it('does not need a generation slot: a person with none left still gets a suggestion', async () => {
    const { service, create } = build({ usage: { generationsUsed: 5, suggestionsUsed: 0 } });
    const result = await service.run(USER);
    expect(result).toMatchObject({ suggestRequested: true });
    expect(kindsCreated(create)).toEqual(['suggest_topics']);
  });

  it('asks for no suggestion when the suggestion cap is used', async () => {
    const { service, create, enqueue } = build({
      usage: { generationsUsed: 0, suggestionsUsed: 3 },
    });
    const result = await service.run(USER);
    expect(result).toMatchObject({ suggestRequested: false, queueLength: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('never creates a write_story or render_audio job, whatever the sources hold', async () => {
    const scenarios: Setup[] = [
      { ready: [{ topicId: topic(1), storyId: story(1) }] },
      { withoutAudio: [{ topicId: topic(2), storyId: story(2) }] },
      { withoutStory: [topic(3)] },
      {},
      { ready: [{ topicId: topic(1), storyId: story(1) }], withoutAudio: [{ topicId: topic(2), storyId: story(2) }], withoutStory: [topic(3)] },
      { queueLength: 2, withoutStory: [topic(3)] },
    ];
    for (const scenario of scenarios) {
      const { service, create } = build(scenario);
      await service.run(USER);
      expect(kindsCreated(create).filter((kind) => kind !== 'suggest_topics')).toEqual([]);
    }
  });

  it('keeps the suggestion job enqueued after the commit only', async () => {
    const { service, events } = build({});
    await service.run(USER);
    expect(events).toEqual(['commit', 'enqueue:job-suggest_topics-x']);
  });

  it('enqueues nothing when the insert finds an active suggestion', async () => {
    const { service, enqueue } = build({ createResult: () => null });
    const result = await service.run(USER);
    expect(result).toMatchObject({ suggestRequested: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue anything when the transaction fails', async () => {
    const { service, enqueue, tx } = build({});
    tx.queueItem.count.mockRejectedValueOnce(new Error('db down'));
    await expect(service.run(USER)).rejects.toThrow('db down');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('survives an enqueue rejection', async () => {
    const enqueue = jest.fn().mockRejectedValueOnce(new Error('queue down with secret text'));
    const { service } = build({ enqueue });
    await expect(service.run(USER)).resolves.toMatchObject({ suggestRequested: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
