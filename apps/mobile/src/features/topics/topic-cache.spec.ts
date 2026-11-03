import type { QueueItem, TopicsResponse } from '@sleep-stories/contracts';
import { ApiError, ApiUnavailableError } from '../../api/api-client';
import { QueryClient } from '@tanstack/react-query';
import { DEFAULT_FILTER } from './topic-filter';
import {
  applyOptimisticAdd,
  restoreTopics,
  toastForTopicError,
  topicsQueryKey,
  topicsUserKey,
  withInQueue,
  withQueueMembership,
} from './topic-cache';

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

function list(): TopicsResponse {
  return {
    topics: [
      { id: ID(1), title: 'One', style: 'facts', inQueue: true, heard: false, state: 'ready', durationSec: 120 },
      { id: ID(2), title: 'Two', style: 'history', inQueue: false, heard: false, state: 'not_ready', durationSec: null },
      { id: ID(3), title: 'Three', style: 'fairy_tale', inQueue: false, heard: false, state: 'creating', durationSec: null },
    ],
  };
}

function item(n: number, topicN: number): QueueItem {
  return { id: ID(n), topicId: ID(topicN), title: 'x', style: 'facts', heard: false, state: 'not_ready' };
}

describe('topics cache keys', () => {
  it('separates accounts and filters, and the user key is their prefix', () => {
    expect(topicsUserKey('a')).not.toEqual(topicsUserKey('b'));
    const key = topicsQueryKey('a', { ...DEFAULT_FILTER, readyOnly: true });
    expect(key.slice(0, 2)).toEqual(topicsUserKey('a'));
    expect(key).not.toEqual(topicsQueryKey('a', DEFAULT_FILTER));
  });
});

describe('withInQueue', () => {
  it('marks only the named topics and keeps the order and the shape', () => {
    const next = withInQueue(list(), [ID(2)], true);
    expect(next.topics.map((t) => [t.id, t.inQueue])).toEqual([
      [ID(1), true],
      [ID(2), true],
      [ID(3), false],
    ]);
    expect(next.topics[1]).toMatchObject({ state: 'not_ready', durationSec: null });
  });

  it('returns the same rows when nothing changes and does not mutate the input', () => {
    const before = list();
    const next = withInQueue(before, [ID(1)], true);
    expect(next.topics[0]).toBe(before.topics[0]);
    withInQueue(before, [ID(1)], false);
    expect(before.topics[0].inQueue).toBe(true);
  });
});

describe('withQueueMembership', () => {
  it('sets and clears inQueue from the queue items', () => {
    const next = withQueueMembership(list(), [item(10, 2), item(11, 3)]);
    expect(next.topics.map((t) => t.inQueue)).toEqual([false, true, true]);
  });

  it('clears everything for an empty queue', () => {
    expect(withQueueMembership(list(), []).topics.every((t) => !t.inQueue)).toBe(true);
  });

  it('ignores queue topics that are not in this list', () => {
    const next = withQueueMembership(list(), [item(10, 9)]);
    expect(next.topics.every((t) => !t.inQueue)).toBe(true);
  });
});

describe('toastForTopicError', () => {
  it('has its own words for an unavailable topic', () => {
    expect(toastForTopicError(new ApiError(404, 'topic_unavailable'))).toBe(
      'Эта тема сейчас недоступна',
    );
  });

  it('falls back to the queue mapping', () => {
    expect(toastForTopicError(new ApiError(404, 'queue_item_not_found'))).toBe('Очередь изменилась');
    expect(toastForTopicError(new ApiUnavailableError('network'))).toBe(
      'Не получилось. Попробуйте ещё раз',
    );
  });
});

describe('optimistic add and its rollback', () => {
  const filterA = topicsQueryKey('a', DEFAULT_FILTER);
  const filterB = topicsQueryKey('a', { ...DEFAULT_FILTER, readyOnly: true });
  const other = topicsQueryKey('b', DEFAULT_FILTER);

  function client(): QueryClient {
    const queryClient = new QueryClient();
    queryClient.setQueryData(filterA, list());
    queryClient.setQueryData(filterB, list());
    queryClient.setQueryData(other, list());
    return queryClient;
  }

  const flags = (queryClient: QueryClient, key: readonly unknown[]) =>
    queryClient.getQueryData<TopicsResponse>(key)?.topics.map((t) => t.inQueue);

  it('takes a snapshot of this person\'s lists and patches them', async () => {
    const queryClient = client();
    const snapshot = await applyOptimisticAdd(queryClient, 'a', [ID(2)]);
    expect(snapshot.map(([key]) => key)).toEqual(expect.arrayContaining([filterA, filterB]));
    expect(snapshot).toHaveLength(2);
    expect(snapshot.every(([, data]) => data.topics[1].inQueue === false)).toBe(true);
    expect(flags(queryClient, filterA)).toEqual([true, true, false]);
    expect(flags(queryClient, filterB)).toEqual([true, true, false]);
    expect(flags(queryClient, other)).toEqual([true, false, false]);
  });

  it('restores the snapshot on failure without any refetch', async () => {
    const queryClient = client();
    const snapshot = await applyOptimisticAdd(queryClient, 'a', [ID(2), ID(3)]);
    expect(flags(queryClient, filterA)).toEqual([true, true, true]);
    restoreTopics(queryClient, snapshot);
    expect(flags(queryClient, filterA)).toEqual([true, false, false]);
    expect(flags(queryClient, filterB)).toEqual([true, false, false]);
  });

  it('leaves a list without data out of the snapshot and does not cancel its first load', async () => {
    const queryClient = client();
    const loading = topicsQueryKey('a', { ...DEFAULT_FILTER, style: 'history' });
    let cancelled = false;
    void queryClient
      .fetchQuery({
        queryKey: loading,
        queryFn: ({ signal }) =>
          new Promise<TopicsResponse>((resolve) => {
            signal.addEventListener('abort', () => {
              cancelled = true;
            });
            setTimeout(() => resolve(list()), 20);
          }),
      })
      .catch(() => undefined);
    const snapshot = await applyOptimisticAdd(queryClient, 'a', [ID(2)]);
    expect(snapshot.map(([key]) => key)).not.toContainEqual(loading);
    expect(cancelled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    queryClient.clear();
  });
});
