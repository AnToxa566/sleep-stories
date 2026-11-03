import type { QueueItem, TopicsResponse } from '@sleep-stories/contracts';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ApiError } from '../../api/api-client';
import { strings } from '../../strings';
import { toastForError } from '../today/queue-cache';
import type { TopicFilter } from './topic-filter';

// Pure helpers for the cached list «Темы»: its key and how the list follows the queue when the
// queue changes. No React, no Expo: unit-tested. The hooks are in use-topics.ts and in
// features/today/queue-queries.ts.

// The key carries the user id only to keep accounts apart; it is not sent. Every filter has its
// own cached list, and `topicsUserKey` is the prefix of all of them.
export const topicsUserKey = (userId: string | null) => ['topics', userId] as const;

export const topicsQueryKey = (userId: string | null, filter: TopicFilter) =>
  ['topics', userId, filter.style, filter.ready, filter.heard] as const;

// The list with `inQueue` set for the given topics. Used for the optimistic add. Other
// topics, and the order, are untouched.
export function withInQueue(
  response: TopicsResponse,
  topicIds: readonly string[],
  inQueue: boolean,
): TopicsResponse {
  const ids = new Set(topicIds);
  return {
    ...response,
    topics: response.topics.map((topic) =>
      ids.has(topic.id) && topic.inQueue !== inQueue ? { ...topic, inQueue } : topic,
    ),
  };
}

// What the cached topic lists held before an optimistic change: one entry per list that had data.
export type TopicsSnapshot = ReadonlyArray<readonly [QueryKey, TopicsResponse]>;

// The optimistic add. Cancels the reads of lists that already have data (so an older answer
// cannot overwrite the patch; a first load in flight is left alone, or it would never refetch),
// takes a snapshot of those lists, then sets `inQueue` on them. Returns the snapshot for
// `restoreTopics`.
export async function applyOptimisticAdd(
  queryClient: QueryClient,
  userId: string | null,
  topicIds: readonly string[],
): Promise<TopicsSnapshot> {
  const queryKey = topicsUserKey(userId);
  await queryClient.cancelQueries({
    queryKey,
    predicate: (query) => query.state.data !== undefined,
  });
  const snapshot: Array<readonly [QueryKey, TopicsResponse]> = [];
  for (const [key, data] of queryClient.getQueriesData<TopicsResponse>({ queryKey })) {
    if (data !== undefined) snapshot.push([key, data]);
  }
  queryClient.setQueriesData<TopicsResponse>({ queryKey }, (old) =>
    old === undefined ? old : withInQueue(old, topicIds, true),
  );
  return snapshot;
}

// Puts the snapshot back. It does not depend on a refetch: with the network down the refetch
// fails too, and the optimistic ✓ would stay in the cache.
export function restoreTopics(queryClient: QueryClient, snapshot: TopicsSnapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData<TopicsResponse>(key, data);
}

// The list with `inQueue` taken from the queue as it is now. Every queue edit and every
// queue read runs this over the cached lists, so the ✓ marks and the queue never disagree.
export function withQueueMembership(
  response: TopicsResponse,
  items: readonly QueueItem[],
): TopicsResponse {
  const held = new Set(items.map((item) => item.topicId));
  return {
    ...response,
    topics: response.topics.map((topic) =>
      held.has(topic.id) === topic.inQueue ? topic : { ...topic, inQueue: held.has(topic.id) },
    ),
  };
}

// The message for a failed add or replace. A topic the person may not queue (or that is gone)
// has its own words; everything else is the queue's mapping (generic, «Очередь изменилась»).
export function toastForTopicError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'topic_unavailable') {
    return strings.topics.errors.unavailable;
  }
  return toastForError(error);
}
