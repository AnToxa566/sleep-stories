import { z } from 'zod';
import { StoryStyleSchema } from './story-style';

// One item of a person's queue as served by GET /api/queue (ARCHITECTURE.md section 6,
// "Readiness and the four states"). The state is derived from the data in the person's
// voice and never stored. Only a `ready` item carries the story id, the duration and a
// short-lived signed audio URL; the stored audio path is never sent, and the URL is never
// stored (section 5, "Paths, not URLs"). The two shapes are strict so an item cannot
// carry a URL while it is not ready.
const QueueItemBase = {
  id: z.uuid(),
  topicId: z.uuid(),
  title: z.string(),
  style: StoryStyleSchema,
};

export const ReadyQueueItemSchema = z.strictObject({
  ...QueueItemBase,
  state: z.literal('ready'),
  storyId: z.uuid(),
  durationSec: z.number().int().positive(),
  audioUrl: z.url(),
});

export const NotReadyQueueItemSchema = z.strictObject({
  ...QueueItemBase,
  state: z.enum(['creating', 'failed', 'not_ready']),
});

export const QueueItemSchema = z.discriminatedUnion('state', [
  ReadyQueueItemSchema,
  NotReadyQueueItemSchema,
]);

// Built from the two item schemas, so the state names cannot drift from them.
export const QueueItemStateSchema = z.enum([
  ReadyQueueItemSchema.shape.state.value,
  ...NotReadyQueueItemSchema.shape.state.options,
]);

// `generations` tells the app how many generations the person has left in the rolling
// window, so the number is not hardcoded in the app (ARCHITECTURE.md section 11, item 32).
// It is for display; the server enforces the limit when a generation starts.
//
// `collecting` is true only while the queue is empty and a topic-suggestion job of this person
// is in progress and recent, so the app can show "collecting topics" instead of an empty list.
export const QueueResponseSchema = z.strictObject({
  items: z.array(QueueItemSchema),
  generations: z.strictObject({
    left: z.number().int().min(0),
    limit: z.number().int().min(1),
  }),
  collecting: z.boolean(),
});

// The most items one person's queue can hold. A reorder names every item, so it is bounded by
// the same number as an add; the add checks the sum on the server too.
export const QUEUE_MAX_ITEMS = 100;

// The full list of the person's queue item ids in the wanted order. It must be exactly the
// ids in the queue: no missing, no extra, no repeated one.
export const ReorderQueueRequestSchema = z
  .strictObject({
    itemIds: z.array(z.uuid()).max(QUEUE_MAX_ITEMS),
  })
  .refine((value) => new Set(value.itemIds).size === value.itemIds.length, {
    message: 'itemIds must not repeat',
    path: ['itemIds'],
  });

// POST /api/queue/items: topics to append to the end of the queue, in this order. At least
// one, no repeats. Whether each topic may be queued by this person is decided on the server.
export const AddToQueueRequestSchema = z
  .strictObject({
    topicIds: z.array(z.uuid()).min(1).max(QUEUE_MAX_ITEMS),
  })
  .refine((value) => new Set(value.topicIds).size === value.topicIds.length, {
    message: 'topicIds must not repeat',
    path: ['topicIds'],
  });

// POST /api/queue/items/:itemId/replace: the topic that takes the place of the item's topic.
export const ReplaceQueueItemRequestSchema = z.strictObject({ topicId: z.uuid() });

// The route parameter of DELETE /api/queue/items/:itemId. A malformed id is a 400, before any query.
export const QueueItemParamsSchema = z.strictObject({ itemId: z.uuid() });

export type QueueItem = z.infer<typeof QueueItemSchema>;
export type QueueItemState = z.infer<typeof QueueItemStateSchema>;
export type QueueResponse = z.infer<typeof QueueResponseSchema>;
export type ReorderQueueRequest = z.infer<typeof ReorderQueueRequestSchema>;
export type AddToQueueRequest = z.infer<typeof AddToQueueRequestSchema>;
export type ReplaceQueueItemRequest = z.infer<typeof ReplaceQueueItemRequestSchema>;
