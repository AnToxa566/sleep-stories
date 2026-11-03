import * as lock from '../prisma/lock-user-row';
import * as candidates from './queue-candidates';
import { QueueRebuildService } from './queue-rebuild.service';

jest.mock('../prisma/lock-user-row', () => ({ lockUserRow: jest.fn().mockResolvedValue(true) }));
jest.mock('./queue-candidates', () => ({
  findReady: jest.fn(),
  findWithoutAudio: jest.fn(),
  findWithoutStory: jest.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(1);
const VOICE = id(2);
const queueFromReader = { items: [], generations: { left: 5, limit: 5 }, collecting: false };
const found = (n: number) => ({ topicId: id(n), storyId: id(n + 100) });

// The database part is proven in queue-rebuild.int-spec.ts. This spec pins the order of the
// steps, that every write names the person, the options of the finders, and that the service
// never reaches the job service (it only calls the top-up, which may create suggest_topics).
function build(preferences: { voiceId: string } | null = { voiceId: VOICE }) {
  const tx = {
    userPreference: { findUnique: jest.fn().mockResolvedValue(preferences) },
    queueItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<number>) => fn(tx)) };
  const reader = { read: jest.fn().mockResolvedValue(queueFromReader) };
  const topUp = { run: jest.fn().mockResolvedValue({ queued: {} }) };
  const jobs = { create: jest.fn() };
  return {
    tx,
    reader,
    topUp,
    jobs,
    service: new QueueRebuildService(prisma as never, reader as never, topUp as never),
  };
}

describe('QueueRebuildService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (candidates.findReady as jest.Mock).mockResolvedValue([]);
    (candidates.findWithoutAudio as jest.Mock).mockResolvedValue([]);
    (candidates.findWithoutStory as jest.Mock).mockResolvedValue([]);
  });

  it('replaces the queue with three unheard topics in finder order and does not top up', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([found(10)]);
    (candidates.findWithoutAudio as jest.Mock).mockResolvedValue([found(11)]);
    (candidates.findWithoutStory as jest.Mock).mockResolvedValue([id(12)]);
    const { tx, topUp, reader, service } = build();
    const result = await service.run(USER);

    expect(result).toBe(queueFromReader);
    expect(lock.lockUserRow).toHaveBeenCalledWith(tx, USER);
    expect(candidates.findReady).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER, voiceId: VOICE, heard: 'exclude', includeQueued: true, limit: 3 }),
    );
    expect(candidates.findWithoutAudio).toHaveBeenCalledWith(tx, expect.objectContaining({ limit: 2, heard: 'exclude' }));
    expect(candidates.findWithoutStory).toHaveBeenCalledWith(tx, expect.objectContaining({ limit: 1, heard: 'exclude' }));
    expect(tx.queueItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(tx.queueItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER, topicId: id(10), position: 1 },
        { userId: USER, topicId: id(11), position: 2 },
        { userId: USER, topicId: id(12), position: 3 },
      ],
    });
    expect(topUp.run).not.toHaveBeenCalled();
    expect(reader.read).toHaveBeenCalledWith(USER);
  });

  it('deletes the queue and tops up for this person when nothing unheard is found', async () => {
    const { tx, topUp, service } = build();
    await service.run(USER);

    expect(tx.queueItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(tx.queueItem.createMany).not.toHaveBeenCalled();
    expect(topUp.run).toHaveBeenCalledWith(USER);
  });

  it('tops up when fewer than three were found', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([found(10), found(11)]);
    const { topUp, service } = build();
    await service.run(USER);
    expect(topUp.run).toHaveBeenCalledWith(USER);
  });

  it('never calls the job service: the top-up is the only way a job can come out of it', async () => {
    const { jobs, service } = build();
    await service.run(USER);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(Object.keys(service)).not.toContain('jobs');
  });

  it('touches nothing for a person with no preferences, and for a token with no users row', async () => {
    const first = build(null);
    await first.service.run(USER);
    expect(first.tx.queueItem.deleteMany).not.toHaveBeenCalled();
    expect(candidates.findReady).not.toHaveBeenCalled();

    (lock.lockUserRow as jest.Mock).mockResolvedValueOnce(false);
    const second = build();
    await second.service.run(USER);
    expect(second.tx.queueItem.deleteMany).not.toHaveBeenCalled();
  });
});
