import type { Prisma } from '../../../generated/prisma/client';
import { appendToQueue } from './append-to-queue';

const USER = '11111111-1111-4111-8111-111111111111';

function fakeTx(lastPosition: number | null) {
  const queueItem = {
    aggregate: jest.fn(async () => ({ _max: { position: lastPosition } })),
    createMany: jest.fn(async () => ({ count: 0 })),
  };
  return { queueItem, tx: { queueItem } as unknown as Prisma.TransactionClient };
}

describe('appendToQueue', () => {
  it('continues after the last position of this person, in the order given', async () => {
    const { queueItem, tx } = fakeTx(4);
    await appendToQueue(tx, USER, ['a', 'b']);
    expect(queueItem.aggregate).toHaveBeenCalledWith({ where: { userId: USER }, _max: { position: true } });
    expect(queueItem.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER, topicId: 'a', position: 5 },
        { userId: USER, topicId: 'b', position: 6 },
      ],
    });
  });

  it('starts an empty queue at position 1 and passes skipDuplicates on', async () => {
    const { queueItem, tx } = fakeTx(null);
    await appendToQueue(tx, USER, ['a'], { skipDuplicates: true });
    expect(queueItem.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER, topicId: 'a', position: 1 }],
      skipDuplicates: true,
    });
  });

  it('does nothing for an empty list', async () => {
    const { queueItem, tx } = fakeTx(4);
    await appendToQueue(tx, USER, []);
    expect(queueItem.aggregate).not.toHaveBeenCalled();
    expect(queueItem.createMany).not.toHaveBeenCalled();
  });
});
