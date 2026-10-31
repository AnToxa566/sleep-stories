import {
  AddToQueueRequestSchema,
  QUEUE_MAX_ITEMS,
  QueueItemParamsSchema,
  QueueItemSchema,
  QueueResponseSchema,
  ReorderQueueRequestSchema,
  ReplaceQueueItemRequestSchema,
} from './queue';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { id: id(1), topicId: id(2), title: 'Тема', style: 'facts' };
const ready = {
  ...base,
  state: 'ready',
  storyId: id(3),
  durationSec: 600,
  audioUrl: 'https://signed.example.test/opaque?token=x',
};

describe('QueueItemSchema', () => {
  it('accepts a ready item and each not-ready state', () => {
    expect(QueueItemSchema.safeParse(ready).success).toBe(true);
    for (const state of ['creating', 'failed', 'not_ready']) {
      expect(QueueItemSchema.safeParse({ ...base, state }).success).toBe(true);
    }
  });

  it('rejects a not-ready item that carries story data or a URL', () => {
    for (const extra of [{ storyId: id(3) }, { durationSec: 5 }, { audioUrl: ready.audioUrl }]) {
      expect(QueueItemSchema.safeParse({ ...base, state: 'not_ready', ...extra }).success).toBe(false);
    }
  });

  it('rejects a ready item without its data, with a bad duration, or with a storage path', () => {
    for (const key of ['storyId', 'durationSec', 'audioUrl']) {
      const copy: Record<string, unknown> = { ...ready };
      delete copy[key];
      expect(QueueItemSchema.safeParse(copy).success).toBe(false);
    }
    expect(QueueItemSchema.safeParse({ ...ready, durationSec: 0 }).success).toBe(false);
    expect(QueueItemSchema.safeParse({ ...ready, durationSec: 1.5 }).success).toBe(false);
    expect(QueueItemSchema.safeParse({ ...ready, audioUrl: 'stories/a/b.mp3' }).success).toBe(false);
    expect(QueueItemSchema.safeParse({ ...ready, storagePath: 'stories/a/b.mp3' }).success).toBe(false);
  });

  it('rejects an unknown state, a bad id and an unknown style', () => {
    expect(QueueItemSchema.safeParse({ ...base, state: 'done' }).success).toBe(false);
    expect(QueueItemSchema.safeParse({ ...base, id: 'x', state: 'failed' }).success).toBe(false);
    expect(QueueItemSchema.safeParse({ ...base, style: 'news', state: 'failed' }).success).toBe(false);
  });
});

describe('QueueResponseSchema', () => {
  const generations = { left: 5, limit: 5 };

  it('accepts a list, including an empty one', () => {
    expect(QueueResponseSchema.safeParse({ items: [ready], generations, collecting: false }).success).toBe(true);
    expect(QueueResponseSchema.safeParse({ items: [], generations, collecting: false }).success).toBe(true);
  });

  it('rejects a negative left, a zero limit, a missing block and an extra key', () => {
    expect(QueueResponseSchema.safeParse({ items: [], generations: { left: -1, limit: 5 }, collecting: false }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], generations: { left: 0, limit: 0 }, collecting: false }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], collecting: false }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], generations }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], generations, collecting: false, extra: 1 }).success).toBe(false);
  });
});

describe('ReorderQueueRequestSchema', () => {
  it('accepts a list of distinct ids, including an empty one', () => {
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: [id(1), id(2)] }).success).toBe(true);
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: [] }).success).toBe(true);
  });

  it('rejects a repeated id, a bad id, more than 100 ids and an extra key', () => {
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: [id(1), id(1)] }).success).toBe(false);
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: ['x'] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => id(i + 1));
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: many }).success).toBe(false);
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: [], extra: 1 }).success).toBe(false);
  });
});

describe('QueueItemParamsSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(QueueItemParamsSchema.safeParse({ itemId: id(1) }).success).toBe(true);
    expect(QueueItemParamsSchema.safeParse({ itemId: 'abc' }).success).toBe(false);
    expect(QueueItemParamsSchema.safeParse({}).success).toBe(false);
  });
});

describe('QUEUE_MAX_ITEMS', () => {
  it('is 100 and bounds both a reorder and an add', () => {
    expect(QUEUE_MAX_ITEMS).toBe(100);
    const exactly = Array.from({ length: QUEUE_MAX_ITEMS }, (_, i) => id(i + 1));
    expect(ReorderQueueRequestSchema.safeParse({ itemIds: exactly }).success).toBe(true);
    expect(AddToQueueRequestSchema.safeParse({ topicIds: exactly }).success).toBe(true);
  });
});

describe('AddToQueueRequestSchema', () => {
  it('accepts one to 100 distinct ids', () => {
    expect(AddToQueueRequestSchema.safeParse({ topicIds: [id(1)] }).success).toBe(true);
    expect(AddToQueueRequestSchema.safeParse({ topicIds: [id(1), id(2)] }).success).toBe(true);
  });

  it('rejects an empty list, a repeat, a bad id, 101 ids, a missing key and an extra key', () => {
    expect(AddToQueueRequestSchema.safeParse({ topicIds: [] }).success).toBe(false);
    expect(AddToQueueRequestSchema.safeParse({ topicIds: [id(1), id(1)] }).success).toBe(false);
    expect(AddToQueueRequestSchema.safeParse({ topicIds: ['x'] }).success).toBe(false);
    const many = Array.from({ length: QUEUE_MAX_ITEMS + 1 }, (_, i) => id(i + 1));
    expect(AddToQueueRequestSchema.safeParse({ topicIds: many }).success).toBe(false);
    expect(AddToQueueRequestSchema.safeParse({}).success).toBe(false);
    expect(AddToQueueRequestSchema.safeParse({ topicIds: [id(1)], userId: id(9) }).success).toBe(false);
  });
});

describe('ReplaceQueueItemRequestSchema', () => {
  it('accepts a topic id and rejects anything else', () => {
    expect(ReplaceQueueItemRequestSchema.safeParse({ topicId: id(1) }).success).toBe(true);
    expect(ReplaceQueueItemRequestSchema.safeParse({ topicId: 'abc' }).success).toBe(false);
    expect(ReplaceQueueItemRequestSchema.safeParse({}).success).toBe(false);
    expect(ReplaceQueueItemRequestSchema.safeParse({ topicId: id(1), extra: 1 }).success).toBe(false);
  });
});
