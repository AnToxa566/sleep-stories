import type { QueueItem } from '@sleep-stories/contracts';

// Pure helpers for optimistic updates of the queue list. They never mutate their input.

// Moves the item at `from` to position `to`. Out-of-range or equal indices return a copy
// unchanged, so a stray gesture event cannot corrupt the list.
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < copy.length;
  if (!inRange(from) || !inRange(to) || from === to) return copy;
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

// The queue without the item. An unknown id returns an unchanged copy.
export function removeItem<T extends { readonly id: string }>(
  items: readonly T[],
  itemId: string,
): T[] {
  return items.filter((item) => item.id !== itemId);
}

// The body of PUT /queue/order: the item ids in their current order.
export function itemIds(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id);
}

// After «Другая история» the item keeps its id and position and gets another topic. Returns
// the new title when the item with `itemId` now has a different topic than before, otherwise
// null (the item is gone, or the server answered with no change).
export function replacedTitle(
  before: readonly QueueItem[],
  after: readonly QueueItem[],
  itemId: string,
): string | null {
  const previous = before.find((item) => item.id === itemId);
  const next = after.find((item) => item.id === itemId);
  if (previous === undefined || next === undefined) return null;
  return previous.topicId === next.topicId ? null : next.title;
}

// The title of the item that was removed, taken from the queue as it was before.
export function titleOf(items: readonly QueueItem[], itemId: string): string | null {
  return items.find((item) => item.id === itemId)?.title ?? null;
}
