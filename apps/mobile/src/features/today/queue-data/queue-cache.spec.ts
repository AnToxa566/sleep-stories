import type { QueueItem, QueueResponse } from '@sleep-stories/contracts';
import { ApiContractError, ApiError, ApiUnavailableError } from '../../../api/api-client';
import {
  QUEUE_POLL_MS,
  isNothingToCollect,
  queueRefetchInterval,
  rebuiltToast,
  shouldRefetchAfterError,
  withOrder,
  withoutItem,
} from './queue-cache';

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function item(n: number, state: 'not_ready' | 'creating' | 'failed' = 'not_ready'): QueueItem {
  return { id: ID(n), topicId: ID(n + 5), title: `Story ${n}`, style: 'facts', heard: false, state };
}

function queue(items: QueueItem[], collecting = false): QueueResponse {
  return { items, generations: { left: 3, limit: 5 }, collecting };
}

describe('queueRefetchInterval', () => {
  it('does not poll before the first answer', () => {
    expect(queueRefetchInterval(undefined)).toBe(false);
  });
  it('polls while an item is creating', () => {
    expect(queueRefetchInterval(queue([item(1), item(2, 'creating')]))).toBe(QUEUE_POLL_MS);
  });
  it('does not poll for failed or not ready items', () => {
    expect(queueRefetchInterval(queue([item(1), item(2, 'failed')]))).toBe(false);
  });
  it('polls while the server says the queue is collecting', () => {
    expect(queueRefetchInterval(queue([], true))).toBe(QUEUE_POLL_MS);
  });
  it('does not poll an idle empty queue', () => {
    expect(queueRefetchInterval(queue([], false))).toBe(false);
  });
});

describe('isNothingToCollect', () => {
  it('is true only for an empty queue with no suggestion running', () => {
    expect(isNothingToCollect(queue([], false))).toBe(true);
    expect(isNothingToCollect(queue([], true))).toBe(false);
    expect(isNothingToCollect(queue([item(1)], false))).toBe(false);
  });
});

describe('withoutItem', () => {
  it('removes one item and keeps the allowance', () => {
    const before = queue([item(1), item(2), item(3)]);
    const after = withoutItem(before, ID(2));
    expect(after.items.map((i) => i.id)).toEqual([ID(1), ID(3)]);
    expect(after.generations).toEqual(before.generations);
    expect(before.items).toHaveLength(3);
  });
  it('ignores an unknown id', () => {
    expect(withoutItem(queue([item(1)]), ID(9)).items).toHaveLength(1);
  });
});

describe('withOrder', () => {
  const before = queue([item(1), item(2), item(3)]);
  it('applies a full permutation', () => {
    expect(withOrder(before, [ID(3), ID(1), ID(2)]).items.map((i) => i.id)).toEqual([
      ID(3),
      ID(1),
      ID(2),
    ]);
  });
  it('returns the queue unchanged for a stale list', () => {
    expect(withOrder(before, [ID(3), ID(1)])).toBe(before);
    expect(withOrder(before, [ID(3), ID(1), ID(9)])).toBe(before);
    expect(withOrder(before, [ID(1), ID(1), ID(2)])).toBe(before);
  });
});

describe('shouldRefetchAfterError', () => {
  it('refetches after an outage, a 5xx, 409, 404 and 429', () => {
    expect(shouldRefetchAfterError(new ApiUnavailableError('timeout'))).toBe(true);
    expect(shouldRefetchAfterError(new ApiContractError())).toBe(true);
    expect(shouldRefetchAfterError(new ApiError(500, null))).toBe(true);
    expect(shouldRefetchAfterError(new ApiError(409, 'queue_order_mismatch'))).toBe(true);
    expect(shouldRefetchAfterError(new ApiError(404, 'queue_item_not_found'))).toBe(true);
    expect(shouldRefetchAfterError(new ApiError(429, 'generation_limit_reached'))).toBe(true);
  });
  it('does not refetch after a 400, a 401 or an unknown error', () => {
    expect(shouldRefetchAfterError(new ApiError(400, 'validation_failed'))).toBe(false);
    expect(shouldRefetchAfterError(new ApiError(401, 'unauthorized'))).toBe(false);
    expect(shouldRefetchAfterError(new Error('x'))).toBe(false);
  });
});

describe('rebuiltToast', () => {
  const answer = (count: number, collecting = false) => ({
    items: Array.from({ length: count }, (_, n) => item(n + 1)),
    collecting,
    generations: { left: 5, limit: 5 },
  });

  it('declines the noun and the pronoun with the count', () => {
    expect(rebuiltToast(answer(1))).toEqual({
      label: 'Пересобрали очередь',
      title: '1 история, которую вы ещё не слышали',
      kind: 'replace',
    });
    expect(rebuiltToast(answer(2))?.title).toBe('2 истории, которые вы ещё не слышали');
    expect(rebuiltToast(answer(3))?.title).toBe('3 истории, которые вы ещё не слышали');
  });

  it('says nothing for an empty queue, collecting or not', () => {
    expect(rebuiltToast(answer(0, true))).toBeNull();
    expect(rebuiltToast(answer(0, false))).toBeNull();
  });
});
