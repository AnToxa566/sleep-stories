import {
  AddToQueueRequestSchema,
  QueueResponseSchema,
  ReorderQueueRequestSchema,
  ReplaceQueueItemRequestSchema,
  type QueueResponse,
  type TopicsResponse,
} from '@sleep-stories/contracts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { apiFetch } from '../../api/api-fetch';
import { useSessionStore } from '../auth/session-store';
import {
  applyOptimisticAdd,
  restoreTopics,
  toastForTopicError,
  topicsUserKey,
  withQueueMembership,
  type TopicsSnapshot,
} from '../topics/topic-cache';
import {
  QUEUE_MUTATION_KEY,
  queueQueryKey,
  queueRefetchInterval,
  shouldRefetchAfterError,
  toastForError,
  withOrder,
  withoutItem,
} from './queue-cache';
import { replacedTitle, titleOf } from './queue-edit';

// The queue of the screen «Сегодня»: one read and six writes. The pure parts (cache key,
// polling rule, optimistic updates, error mapping) are in queue-cache.ts and tested there.
//
// MONEY (AGENTS.md architecture rule 10): `useGenerateAll` and `useGenerateOne` only return
// a mutation. Nothing in this module calls `mutate` on them: not on mount, not in an effect,
// not in a poll, not in the callback of another query. They are called from the person's
// tap on the main button, «Создать сейчас» or «Повторить», and only there.
// `queue-rule-10.spec.ts` fails if the two names or the path appear in any other file.
//
// The list «Темы» follows the queue: every queue answer, optimistic change and queue read also
// sets `inQueue` on the cached topic lists (syncTopics), so a ✓ never disagrees with the queue.
// `useAddToQueue` and `useReplaceQueueItem` create no job and spend no generation (rule 10).
//
// Toasts belong to the screen: the hooks return messages through `onError`, and the titles
// for «Убрали …» / «Заменили на …» through `onRemoved` / `onReplaced`.

export type QueueMutationCallbacks = {
  // A short Russian message for a toast (toastForError).
  onError?: (message: string) => void;
};

// GET /queue. The key carries the user id only to keep accounts apart; it is not sent.
// Polls every 5 s while an item is `creating`, or while the server reports `collecting`;
// React Query pauses the timer in the background. The screen shows its
// «Не удалось загрузить очередь» state when `isError && data === undefined`: an error on a
// refetch keeps the data that is already on screen.
export function useQueue() {
  const status = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.userId);
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queueQueryKey(userId),
    queryFn: async () => {
      const response = await apiFetch({
        method: 'GET',
        path: '/queue',
        responseSchema: QueueResponseSchema,
      });
      syncTopics(queryClient, response);
      return response;
    },
    enabled: status === 'signedIn' && userId !== null,
    refetchInterval: (query) => queueRefetchInterval(query.state.data),
  });
}

function useQueueKey(): QueryKey {
  const userId = useSessionStore((state) => state.userId);
  return queueQueryKey(userId);
}

// Writes the answer of an edit into the cache. While another edit is still in flight the
// write is skipped: this answer would overwrite that edit's optimistic state. Answers can
// arrive in a different order from the one the server applied them in, so the last edit to
// settle also reads the queue again (settle), which makes the screen right whatever the
// order was. The mutation counts itself while its onSuccess and onSettled run.
function commit(queryClient: QueryClient, key: QueryKey, response: QueueResponse): void {
  if (queryClient.isMutating({ mutationKey: QUEUE_MUTATION_KEY }) > 1) return;
  queryClient.setQueryData(key, response);
  syncTopics(queryClient, response);
}

// Sets `inQueue` on every cached topic list of this person from the queue. A list that is not
// cached is left alone (it is read fresh when its screen mounts).
function syncTopics(queryClient: QueryClient, queue: QueueResponse): void {
  const userId = useSessionStore.getState().userId;
  queryClient.setQueriesData<TopicsResponse>({ queryKey: topicsUserKey(userId) }, (old) =>
    old === undefined ? old : withQueueMembership(old, queue.items),
  );
}

// Called from onSettled of every queue edit. When it is the last one in flight, a read of
// the server's queue replaces whatever the cache holds (it also cancels a poll that was
// answered before the edit and would land after it).
function settle(queryClient: QueryClient, key: QueryKey): void {
  if (queryClient.isMutating({ mutationKey: QUEUE_MUTATION_KEY }) === 1) refetch(queryClient, key);
}

function readQueue(queryClient: QueryClient, key: QueryKey): QueueResponse | undefined {
  return queryClient.getQueryData<QueueResponse>(key);
}

function refetch(queryClient: QueryClient, key: QueryKey): void {
  void queryClient.invalidateQueries({ queryKey: key });
}

type OptimisticContext = {
  readonly previous: QueueResponse | undefined;
  readonly title: string | null;
};

// DELETE /queue/items/:itemId. The row disappears at once; on an error it comes back and
// the queue is read again. `onRemoved(title)` is for the toast «Убрали …».
export function useRemoveQueueItem(
  callbacks: QueueMutationCallbacks & { onRemoved?: (title: string) => void } = {},
) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, string, OptimisticContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: (itemId) =>
      apiFetch({
        method: 'DELETE',
        path: `/queue/items/${encodeURIComponent(itemId)}`,
        responseSchema: QueueResponseSchema,
      }),
    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = readQueue(queryClient, key);
      if (previous !== undefined) {
        const next = withoutItem(previous, itemId);
        queryClient.setQueryData(key, next);
        syncTopics(queryClient, next);
      }
      return { previous, title: previous ? titleOf(previous.items, itemId) : null };
    },
    onSuccess: (response, _itemId, context) => {
      commit(queryClient, key, response);
      if (context?.title) callbacks.onRemoved?.(context.title);
    },
    onError: (error, _itemId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(key, context.previous);
        syncTopics(queryClient, context.previous);
      }
      refetch(queryClient, key);
      callbacks.onError?.(toastForError(error));
    },
    onSettled: () => settle(queryClient, key),
  });
}

// PUT /queue/order with the whole list of ids in the new order (itemIds(moveItem(...))).
// The list is reordered at once; on an error it goes back and the queue is read again.
export function useReorderQueue(callbacks: QueueMutationCallbacks = {}) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, readonly string[], OptimisticContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: (itemIds) =>
      apiFetch({
        method: 'PUT',
        path: '/queue/order',
        body: { schema: ReorderQueueRequestSchema, value: { itemIds: [...itemIds] } },
        responseSchema: QueueResponseSchema,
      }),
    onMutate: async (itemIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = readQueue(queryClient, key);
      if (previous !== undefined) queryClient.setQueryData(key, withOrder(previous, itemIds));
      return { previous, title: null };
    },
    onSuccess: (response) => commit(queryClient, key, response),
    onError: (error, _itemIds, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      refetch(queryClient, key);
      callbacks.onError?.(toastForError(error));
    },
    onSettled: () => settle(queryClient, key),
  });
}

type SnapshotContext = { readonly previous: QueueResponse | undefined };

// Shared by the two generate mutations and «Другая история»: not optimistic, the screen
// shows the server's answer. Running polls are cancelled first so an older answer cannot
// overwrite this one.
function onMutateSnapshot(queryClient: QueryClient, key: QueryKey) {
  return async (): Promise<SnapshotContext> => {
    await queryClient.cancelQueries({ queryKey: key });
    return { previous: readQueue(queryClient, key) };
  };
}

function onErrorRefetch(
  queryClient: QueryClient,
  key: QueryKey,
  callbacks: QueueMutationCallbacks,
) {
  return (error: unknown): void => {
    if (shouldRefetchAfterError(error)) refetch(queryClient, key);
    callbacks.onError?.(toastForError(error));
  };
}

// POST /queue/generate: the main button «Создать и начать». SPENDS THE ALLOWANCE. Call it
// only from the person's tap (rule 10); the server starts every item that needs it, or
// none (429 generation_limit_reached when fewer generations are left than items).
export function useGenerateAll(callbacks: QueueMutationCallbacks = {}) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, void, SnapshotContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: () =>
      apiFetch({ method: 'POST', path: '/queue/generate', responseSchema: QueueResponseSchema }),
    onMutate: onMutateSnapshot(queryClient, key),
    onSuccess: (response) => commit(queryClient, key, response),
    onError: onErrorRefetch(queryClient, key, callbacks),
    onSettled: () => settle(queryClient, key),
  });
}

// POST /queue/items/:itemId/generate: «Создать сейчас» and «Повторить». SPENDS ONE
// GENERATION. Call it only from the person's tap (rule 10).
export function useGenerateOne(callbacks: QueueMutationCallbacks = {}) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, string, SnapshotContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: (itemId) =>
      apiFetch({
        method: 'POST',
        path: `/queue/items/${encodeURIComponent(itemId)}/generate`,
        responseSchema: QueueResponseSchema,
      }),
    onMutate: onMutateSnapshot(queryClient, key),
    onSuccess: (response) => commit(queryClient, key, response),
    onError: onErrorRefetch(queryClient, key, callbacks),
    onSettled: () => settle(queryClient, key),
  });
}

// POST /queue/items/:itemId/another: «Другая история». Creates no job. `onReplaced(title)`
// is for the toast «Заменили на …» and is called only when the topic really changed.
export function useAnotherStory(
  callbacks: QueueMutationCallbacks & { onReplaced?: (title: string) => void } = {},
) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, string, SnapshotContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: (itemId) =>
      apiFetch({
        method: 'POST',
        path: `/queue/items/${encodeURIComponent(itemId)}/another`,
        responseSchema: QueueResponseSchema,
      }),
    onMutate: onMutateSnapshot(queryClient, key),
    onSuccess: (response, itemId, context) => {
      commit(queryClient, key, response);
      const title = replacedTitle(context?.previous?.items ?? [], response.items, itemId);
      if (title !== null) callbacks.onReplaced?.(title);
    },
    onError: onErrorRefetch(queryClient, key, callbacks),
    onSettled: () => settle(queryClient, key),
  });
}

// POST /queue/items: «+» in «Темы». Appends the topics to the end of the queue. Creates no job
// and spends no generation (rule 10). The ✓ appears at once (the cached lists are patched) and
// goes back if the request fails: onMutate keeps a snapshot of the lists and onError puts it
// back, so it does not depend on the refetch (which fails too when the network is down). The server skips a topic that is already queued and refuses
// the whole request (404 topic_unavailable) when one topic may not be queued by this person.
export function useAddToQueue(callbacks: QueueMutationCallbacks = {}) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<
    QueueResponse,
    unknown,
    readonly string[],
    SnapshotContext & { readonly topics: TopicsSnapshot }
  >({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: (topicIds) =>
      apiFetch({
        method: 'POST',
        path: '/queue/items',
        body: { schema: AddToQueueRequestSchema, value: { topicIds: [...topicIds] } },
        responseSchema: QueueResponseSchema,
      }),
    onMutate: async (topicIds) => {
      const topics = await applyOptimisticAdd(queryClient, userId, topicIds);
      return { ...(await onMutateSnapshot(queryClient, key)()), topics };
    },
    onSuccess: (response) => commit(queryClient, key, response),
    onError: (error, _topicIds, context) => {
      if (context !== undefined) restoreTopics(queryClient, context.topics);
      refetch(queryClient, key);
      void queryClient.invalidateQueries({ queryKey: topicsUserKey(userId) });
      callbacks.onError?.(toastForTopicError(error));
    },
    onSettled: () => settle(queryClient, key),
  });
}

// POST /queue/items/:itemId/replace: «Заменить» on the screen «Замена». The item keeps its
// place and gets the chosen topic. Creates no job and spends no generation (rule 10). Not
// optimistic: the screen shows the server's answer. `onReplaced(title)` is for the toast
// «Заменили на …». A 404 (the item is gone, or the topic may not be queued) is reported through
// onError and the queue is read again.
export type ReplaceQueueItemInput = { readonly itemId: string; readonly topicId: string };

export function useReplaceQueueItem(
  callbacks: QueueMutationCallbacks & { onReplaced?: (title: string) => void } = {},
) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<QueueResponse, unknown, ReplaceQueueItemInput, SnapshotContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: ({ itemId, topicId }) =>
      apiFetch({
        method: 'POST',
        path: `/queue/items/${encodeURIComponent(itemId)}/replace`,
        body: { schema: ReplaceQueueItemRequestSchema, value: { topicId } },
        responseSchema: QueueResponseSchema,
      }),
    onMutate: onMutateSnapshot(queryClient, key),
    onSuccess: (response, { itemId }, context) => {
      commit(queryClient, key, response);
      const title = replacedTitle(context?.previous?.items ?? [], response.items, itemId);
      if (title !== null) callbacks.onReplaced?.(title);
    },
    onError: (error) => {
      refetch(queryClient, key);
      void queryClient.invalidateQueries({ queryKey: topicsUserKey(userId) });
      callbacks.onError?.(toastForTopicError(error));
    },
    onSettled: () => settle(queryClient, key),
  });
}

// POST /queue/collect: «Собрать подборку» on the empty queue. The server fills the queue from
// the pool, or starts one topic suggestion (at most 3 per rolling 24 hours). It creates no
// story job and spends no generation, but it is still an explicit action: call it only from
// the person's tap. A cap that is used up is not an error: the answer is an empty queue with
// `collecting: false`, which the screen turns into the toast «Пока не из чего собрать»
// (`isNothingToCollect`). Not optimistic: the screen shows the server's answer.
export function useCollectQueue(
  callbacks: QueueMutationCallbacks & {
    onCollected?: (response: QueueResponse) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  const key = useQueueKey();
  return useMutation<QueueResponse, unknown, void, SnapshotContext>({
    mutationKey: QUEUE_MUTATION_KEY,
    mutationFn: () =>
      apiFetch({ method: 'POST', path: '/queue/collect', responseSchema: QueueResponseSchema }),
    onMutate: onMutateSnapshot(queryClient, key),
    onSuccess: (response) => {
      commit(queryClient, key, response);
      callbacks.onCollected?.(response);
    },
    onError: onErrorRefetch(queryClient, key, callbacks),
    onSettled: () => settle(queryClient, key),
  });
}
