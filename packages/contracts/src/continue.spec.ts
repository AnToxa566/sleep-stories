import { ContinueResponseSchema } from './continue';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const queue = {
  items: [
    {
      id: id(1),
      topicId: id(2),
      title: 'Тема',
      style: 'facts',
      heard: false,
      state: 'ready',
      storyId: id(3),
      durationSec: 600,
      audioUrl: 'https://example.com/a.mp3',
    },
  ],
  generations: { left: 5, limit: 5 },
  collecting: false,
};

describe('ContinueResponseSchema', () => {
  it.each(['ready', 'none_ready'])('accepts the outcome %s with a queue', (outcome) => {
    expect(ContinueResponseSchema.safeParse({ outcome, queue }).success).toBe(true);
  });

  it('accepts an empty queue with none_ready', () => {
    const empty = { ...queue, items: [], collecting: true };
    expect(ContinueResponseSchema.safeParse({ outcome: 'none_ready', queue: empty }).success).toBe(
      true,
    );
  });

  it('rejects an unknown outcome and a missing queue', () => {
    expect(ContinueResponseSchema.safeParse({ outcome: 'ok', queue }).success).toBe(false);
    expect(ContinueResponseSchema.safeParse({ outcome: 'ready' }).success).toBe(false);
  });

  it('rejects a malformed queue and extra keys', () => {
    expect(
      ContinueResponseSchema.safeParse({ outcome: 'ready', queue: { ...queue, items: [{}] } })
        .success,
    ).toBe(false);
    expect(ContinueResponseSchema.safeParse({ outcome: 'ready', queue, userId: id(9) }).success).toBe(
      false,
    );
  });
});
