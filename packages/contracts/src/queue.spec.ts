import { QueueItemParamsSchema, QueueItemSchema, QueueResponseSchema, ReorderQueueRequestSchema } from './queue';

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
    expect(QueueResponseSchema.safeParse({ items: [ready], generations }).success).toBe(true);
    expect(QueueResponseSchema.safeParse({ items: [], generations }).success).toBe(true);
  });

  it('rejects a negative left, a zero limit, a missing block and an extra key', () => {
    expect(QueueResponseSchema.safeParse({ items: [], generations: { left: -1, limit: 5 } }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], generations: { left: 0, limit: 0 } }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [] }).success).toBe(false);
    expect(QueueResponseSchema.safeParse({ items: [], generations, extra: 1 }).success).toBe(false);
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
