import * as lock from '../prisma/lock-user-row';
import * as candidates from './queue-candidates';
import { QueueContinueService } from './queue-continue.service';

jest.mock('../prisma/lock-user-row', () => ({ lockUserRow: jest.fn().mockResolvedValue(true) }));
jest.mock('./queue-candidates', () => ({ findReady: jest.fn() }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(1);
const VOICE = id(2);
const queueFromReader = { items: [], generations: { left: 5, limit: 5 }, collecting: false };

// The database part is proven in queue-continue.int-spec.ts. This spec pins what a black-box
// test cannot see: the order of the steps, that every write names the person, and that the
// top-up path deletes nothing.
function build(preferences: { voiceId: string } | null = { voiceId: VOICE }) {
  const tx = {
    userPreference: { findUnique: jest.fn().mockResolvedValue(preferences) },
    queueItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<boolean>) => fn(tx)) };
  const reader = { read: jest.fn().mockResolvedValue(queueFromReader) };
  const topUp = { run: jest.fn().mockResolvedValue({ queued: {} }) };
  return {
    tx,
    reader,
    topUp,
    service: new QueueContinueService(prisma as never, reader as never, topUp as never),
  };
}

describe('QueueContinueService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('replaces the queue with the found stories, in order, and does not top up', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([
      { topicId: id(10), storyId: id(20) },
      { topicId: id(11), storyId: id(21) },
    ]);
    const { tx, topUp, service } = build();
    const result = await service.run(USER);

    expect(result).toEqual({ outcome: 'ready', queue: queueFromReader });
    expect(lock.lockUserRow).toHaveBeenCalledWith(tx, USER);
    expect(candidates.findReady).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER, voiceId: VOICE, includeQueued: true }),
    );
    expect(tx.queueItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    expect(tx.queueItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER, topicId: id(10), position: 1 },
        { userId: USER, topicId: id(11), position: 2 },
      ],
    });
    expect(topUp.run).not.toHaveBeenCalled();
  });

  it('queues a topic once even when the finder returns it twice', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([
      { topicId: id(10), storyId: id(20) },
      { topicId: id(10), storyId: id(21) },
    ]);
    const { tx, service } = build();
    await service.run(USER);
    expect(tx.queueItem.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER, topicId: id(10), position: 1 }],
    });
  });

  it('touches nothing and tops up for this person when no ready story is found', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([]);
    const { tx, topUp, service } = build();
    const result = await service.run(USER);

    expect(result).toEqual({ outcome: 'none_ready', queue: queueFromReader });
    expect(tx.queueItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.queueItem.createMany).not.toHaveBeenCalled();
    expect(topUp.run).toHaveBeenCalledWith(USER);
  });

  it('does not search, write or replace for a person with no preferences', async () => {
    const { tx, topUp, service } = build(null);
    const result = await service.run(USER);

    expect(result.outcome).toBe('none_ready');
    expect(candidates.findReady).not.toHaveBeenCalled();
    expect(tx.queueItem.deleteMany).not.toHaveBeenCalled();
    expect(topUp.run).toHaveBeenCalledWith(USER);
  });

  it('does nothing for a token whose person has no users row', async () => {
    (lock.lockUserRow as jest.Mock).mockResolvedValueOnce(false);
    const { tx, service } = build();
    const result = await service.run(USER);

    expect(result.outcome).toBe('none_ready');
    expect(candidates.findReady).not.toHaveBeenCalled();
    expect(tx.queueItem.deleteMany).not.toHaveBeenCalled();
  });
});
