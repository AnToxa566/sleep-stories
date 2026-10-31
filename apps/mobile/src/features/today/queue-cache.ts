import {
  type QueueItem,
  type QueueResponse,
} from '@sleep-stories/contracts';
import { ApiContractError, ApiError, ApiUnavailableError } from '../../api/api-client';
import { strings } from '../../strings';
import { hasCreating } from './main-button';
import { removeItem } from './queue-edit';

// Pure helpers for the queue query: the cache key, the polling rule, optimistic cache
// updates and the error mapping. Nothing here imports React Native, Expo or React, so it is
// unit-tested. The hooks that use it are in queue-queries.ts.

export const QUEUE_POLL_MS = 5000;

// The user id only separates one account's cache from another's. It is never sent: the API
// reads the person from the token.
export const queueQueryKey = (userId: string | null) => ['queue', userId] as const;

// Every queue mutation carries this key, so the number of queue edits in flight is known.
export const QUEUE_MUTATION_KEY = ['queue', 'mutation'] as const;

// How often to poll, or false for no polling. Polls only while an item is being made, or
// while the server says the queue is being collected (`collecting` in the answer, derived on
// the server from a pending suggest_topics job). React Query pauses the interval when the app
// is in the background (focusManager is wired to AppState).
export function queueRefetchInterval(data: QueueResponse | undefined): number | false {
  if (data === undefined) return false;
  if (hasCreating(data.items) || data.collecting) return QUEUE_POLL_MS;
  return false;
}

// Whether the answer of «Собрать подборку» came back with nothing: an empty queue and no
// suggestion running (the pool was empty and the daily cap of suggestions is used up).
export function isNothingToCollect(response: QueueResponse): boolean {
  return response.items.length === 0 && !response.collecting;
}

// The queue without the item (optimistic remove). `generations` is unchanged.
export function withoutItem(queue: QueueResponse, itemId: string): QueueResponse {
  return { ...queue, items: removeItem(queue.items, itemId) };
}

// The queue in the given order (optimistic reorder). `itemIds` must be exactly the ids in
// the queue; anything else (a stale list) returns the queue unchanged, so a wrong list can
// never drop or duplicate an item in the cache. The server checks the same rule (409).
export function withOrder(queue: QueueResponse, itemIds: readonly string[]): QueueResponse {
  if (itemIds.length !== queue.items.length) return queue;
  const byId = new Map<string, QueueItem>(queue.items.map((item) => [item.id, item]));
  const ordered: QueueItem[] = [];
  for (const id of itemIds) {
    const item = byId.get(id);
    if (item === undefined) return queue;
    byId.delete(id);
    ordered.push(item);
  }
  return { ...queue, items: ordered };
}

// The message for the toast after a failed request. Any code the screen does not know is
// the generic one. Fixed Russian copy only; nothing from the error goes to the person.
export function toastForError(error: unknown): string {
  const text = strings.today.errors;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'generation_limit_reached':
        return text.notEnoughGenerations;
      case 'topic_unavailable':
        return text.noOtherStory;
      case 'queue_order_mismatch':
      case 'queue_item_not_found':
        return text.queueChanged;
      default:
        return text.generic;
    }
  }
  return text.generic;
}

// Whether the queue on screen may no longer match the server after this error, so it must
// be read again before anything else (ARCHITECTURE.md section 6, known limit): an outage
// or timeout (the request may have been applied), a server error, 409 (the order changed),
// 404 (the item is gone) and 429 (the allowance on screen is stale). A 400 or 401 changes nothing.
export function shouldRefetchAfterError(error: unknown): boolean {
  if (error instanceof ApiUnavailableError || error instanceof ApiContractError) return true;
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 409 || error.status === 404 || error.status === 429;
  }
  return false;
}
