import type { PrismaService } from '../prisma/prisma.service';
import type { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService } from './generation-jobs.service';
import type { GenerationLimitsService } from './generation-limits.service';
import { findReady, findRendering, findStalled, findWriting } from './queue-candidates';
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
  usage?: { rendersUsed: number; suggestionsUsed: number };
  ready?: { topicId: string; storyId: string }[];
  rendering?: { topicId: string; storyId: string }[];
  writing?: string[];
  stalled?: { topicId: string; storyId: string }[];
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
    usage: jest.fn(async () => setup.usage ?? { rendersUsed: 0, suggestionsUsed: 0 }),
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
  (findRendering as jest.Mock).mockResolvedValue(setup.rendering ?? []);
  (findStalled as jest.Mock).mockResolvedValue(setup.stalled ?? []);
  (findWriting as jest.Mock).mockResolvedValue(setup.writing ?? []);

  const service = new QueueTopUpService(prisma, limits, jobs, jobQueue);
  return { service, tx, create, enqueue, events, limits };
}

describe('QueueTopUpService.run', () => {
  beforeEach(() => jest.clearAllMocks());

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
    await expect(service.run(USER)).resolves.toEqual({ skipped: 'queue_full', healed: 0 });
    expect(findReady).not.toHaveBeenCalled();
    expect(tx.queueItem.createMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues the tiers in order, appends positions and counts the result', async () => {
    const { service, tx, create } = build({
      ready: [{ topicId: topic(1), storyId: story(1) }],
      rendering: [{ topicId: topic(2), storyId: story(2) }],
      writing: [topic(3)],
    });
    const result = await service.run(USER);
    expect(result).toEqual({
      queued: { ready: 1, rendering: 1, writing: 1 },
      suggestRequested: false,
      limitReached: false,
      queueLength: 3,
      healed: 0,
    });
    expect(tx.queueItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER, topicId: topic(1), position: 5 },
        { userId: USER, topicId: topic(2), position: 6 },
        { userId: USER, topicId: topic(3), position: 7 },
      ],
      skipDuplicates: true,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, tx, {
      userId: USER,
      payload: { kind: 'render_audio', storyId: story(2), voiceId: VOICE },
    });
    expect(create).toHaveBeenNthCalledWith(2, tx, {
      userId: USER,
      payload: { kind: 'write_story', topicId: topic(3), voiceId: VOICE },
    });
  });

  it('asks for suggestions when nothing fits and reports it', async () => {
    const { service, create } = build({ queueLength: 1 });
    const result = await service.run(USER);
    expect(result).toEqual({
      queued: { ready: 0, rendering: 0, writing: 0 },
      suggestRequested: true,
      limitReached: false,
      queueLength: 1,
      healed: 0,
    });
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      userId: USER,
      payload: { kind: 'suggest_topics', missing: 2 },
    });
  });

  it('reports limitReached when no slot is left and only ready stories are queued', async () => {
    const { service, create } = build({
      usage: { rendersUsed: 5, suggestionsUsed: 0 },
      ready: [{ topicId: topic(1), storyId: story(1) }],
      rendering: [{ topicId: topic(2), storyId: story(2) }],
    });
    const result = await service.run(USER);
    expect(result).toEqual({
      queued: { ready: 1, rendering: 0, writing: 0 },
      suggestRequested: false,
      limitReached: true,
      queueLength: 1,
      healed: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the queue item but enqueues nothing when a job insert finds an active job', async () => {
    const { service, tx, enqueue } = build({
      writing: [topic(3)],
      createResult: (spec) => (spec.payload.kind === 'write_story' ? null : 'job-s'),
    });
    const result = await service.run(USER);
    expect(tx.queueItem.createMany).toHaveBeenCalled();
    expect(result).toMatchObject({ queued: { writing: 1 }, queueLength: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('job-s');
  });

  it('enqueues only after the transaction committed, and only created job ids', async () => {
    const { service, events } = build({
      rendering: [
        { topicId: topic(1), storyId: story(1) },
        { topicId: topic(2), storyId: story(2) },
      ],
      createResult: (spec) => (spec.payload.storyId === story(2) ? null : defaultId(spec)),
    });
    await service.run(USER);
    expect(events[0]).toBe('commit');
    expect(events.slice(1)).toEqual([
      `enqueue:job-render_audio-${story(1)}`,
      'enqueue:job-suggest_topics-x',
    ]);
  });

  it('does not enqueue anything when the transaction fails', async () => {
    const { service, enqueue, tx } = build({});
    tx.queueItem.count.mockRejectedValueOnce(new Error('db down'));
    await expect(service.run(USER)).rejects.toThrow('db down');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('survives an enqueue rejection and still enqueues the other jobs', async () => {
    const enqueue = jest
      .fn()
      .mockRejectedValueOnce(new Error('queue down with secret text'))
      .mockResolvedValue(undefined);
    const { service } = build({
      rendering: [
        { topicId: topic(1), storyId: story(1) },
        { topicId: topic(2), storyId: story(2) },
      ],
      createResult: (spec) =>
        spec.payload.kind === 'suggest_topics' ? 'job-s' : `job-${spec.payload.storyId === story(1) ? 1 : 2}`,
      enqueue,
    });
    const result = await service.run(USER);
    expect(result).toMatchObject({ queued: { rendering: 2 } });
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenNthCalledWith(1, 'job-1');
    expect(enqueue).toHaveBeenNthCalledWith(2, 'job-2');
    expect(enqueue).toHaveBeenNthCalledWith(3, 'job-s');
  });

  describe('stalled items', () => {
    const stalled = [{ topicId: topic(5), storyId: story(5) }];

    it('heals a stalled item on the queue_full return and enqueues it after the commit', async () => {
      const { service, create, events, tx } = build({ queueLength: 3, stalled });
      const result = await service.run(USER);
      expect(result).toEqual({ skipped: 'queue_full', healed: 1 });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(tx, {
        userId: USER,
        payload: { kind: 'render_audio', storyId: story(5), voiceId: VOICE },
      });
      expect(tx.queueItem.createMany).not.toHaveBeenCalled();
      expect(events).toEqual(['commit', `enqueue:job-render_audio-${story(5)}`]);
      expect(findReady).not.toHaveBeenCalled();
    });

    it('asks for at most the free render slots and takes them off before planning', async () => {
      const { service } = build({
        usage: { rendersUsed: 4, suggestionsUsed: 0 },
        stalled,
        rendering: [{ topicId: topic(2), storyId: story(2) }],
        ready: [{ topicId: topic(1), storyId: story(1) }],
      });
      const result = await service.run(USER);
      expect(findStalled).toHaveBeenCalledWith(expect.anything(), {
        userId: USER,
        voiceId: VOICE,
        limit: 1,
      });
      // The one free slot went to the healed item, so the rendering candidate is dropped.
      expect(result).toMatchObject({ queued: { ready: 1, rendering: 0 }, healed: 1 });
    });

    it('counts only created heal jobs and survives a null insert', async () => {
      const { service, enqueue } = build({
        queueLength: 3,
        stalled,
        createResult: () => null,
      });
      await expect(service.run(USER)).resolves.toEqual({ skipped: 'queue_full', healed: 0 });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not heal for a person without preferences', async () => {
      const { service, create } = build({ preferences: null, stalled });
      await service.run(USER);
      expect(findStalled).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('inserts all jobs in the order of their dedupe keys', async () => {
      const { service, create } = build({
        queueLength: 0,
        stalled,
        rendering: [{ topicId: topic(2), storyId: story(2) }],
        writing: [topic(3)],
      });
      await service.run(USER);
      const keys = create.mock.calls.map(([, spec]) => {
        const p = spec.payload;
        if (p.kind === 'write_story') return `write_story:${p.topicId}`;
        if (p.kind === 'suggest_topics') return `suggest_topics:${USER}`;
        return `render_audio:${p.storyId}:${VOICE}`;
      });
      expect(keys).toHaveLength(4);
      expect(keys).toEqual([...keys].sort());
    });
  });
});
