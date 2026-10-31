import { QueuePickService } from './queue-pick.service';
import * as candidates from './queue-candidates';

jest.mock('../prisma/lock-user-row', () => ({ lockUserRow: jest.fn().mockResolvedValue(true) }));
jest.mock('./queue-candidates', () => ({
  findEligible: jest.fn(),
  findReady: jest.fn(),
  findWithoutAudio: jest.fn(),
  findWithoutStory: jest.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(1);
const ITEM = id(2);
const OLD_TOPIC = id(3);
const NEW_TOPIC = id(4);

// The database part of the service is proven in queue-pick.int-spec.ts. This unit spec pins
// what a black-box test cannot: the UPDATE names the person again, and the lookup of the item
// names both the item and the person (defence in depth behind the lock and the lookup).
function build() {
  const tx = {
    userPreference: { findUnique: jest.fn().mockResolvedValue({ voiceId: id(9) }) },
    queueItem: {
      findFirst: jest.fn().mockResolvedValue({ id: ITEM, topicId: OLD_TOPIC, topic: { style: 'facts' } }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)) };
  const reader = { read: jest.fn().mockResolvedValue({ items: [] }) };
  return { tx, service: new QueuePickService(prisma as never, reader as never) };
}

describe('QueuePickService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('replace looks the item up by id and person, and updates by id and person, changing only the topic', async () => {
    (candidates.findEligible as jest.Mock).mockResolvedValue(new Set([NEW_TOPIC]));
    const { tx, service } = build();
    await service.replace(USER, ITEM, NEW_TOPIC);
    expect(tx.queueItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM, userId: USER } }),
    );
    expect(tx.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, userId: USER },
      data: { topicId: NEW_TOPIC },
    });
    expect(candidates.findEligible).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER, topicIds: [NEW_TOPIC], includeQueued: false }),
    );
  });

  it('another updates by id and person, using the style of the current topic and the top-up defaults', async () => {
    (candidates.findReady as jest.Mock).mockResolvedValue([]);
    (candidates.findWithoutAudio as jest.Mock).mockResolvedValue([{ topicId: NEW_TOPIC, storyId: id(5) }]);
    const { tx, service } = build();
    await service.another(USER, ITEM);
    expect(tx.queueItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM, userId: USER } }),
    );
    expect(candidates.findReady).toHaveBeenCalledWith(tx, {
      userId: USER,
      voiceId: id(9),
      style: 'facts',
      limit: 1,
    });
    expect(candidates.findWithoutStory).not.toHaveBeenCalled();
    expect(tx.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, userId: USER },
      data: { topicId: NEW_TOPIC },
    });
  });

  it('replace with the held topic changes nothing and checks nothing', async () => {
    const { tx, service } = build();
    await service.replace(USER, ITEM, OLD_TOPIC);
    expect(tx.queueItem.updateMany).not.toHaveBeenCalled();
    expect(candidates.findEligible).not.toHaveBeenCalled();
  });
});
