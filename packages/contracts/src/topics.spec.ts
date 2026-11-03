import {
  SuggestedTopicSchema,
  SuggestedTopicsSchema,
  TopicRowSchema,
  TopicsQuerySchema,
  TopicsResponseSchema,
} from './topics';

const topic = { title: 'Почему небо голубое', style: 'facts', interest: 'space' };

describe('SuggestedTopicSchema', () => {
  it('accepts a title, a style and an interest slug', () => {
    expect(SuggestedTopicSchema.safeParse(topic).success).toBe(true);
  });

  it('accepts a null interest', () => {
    expect(SuggestedTopicSchema.safeParse({ ...topic, interest: null }).success).toBe(true);
  });

  it('trims the title', () => {
    expect(SuggestedTopicSchema.parse({ ...topic, title: '  Луна  ' }).title).toBe('Луна');
  });

  it.each(['', '   ', 'a'.repeat(121), 'two\nlines', 'tab\there', 'a b'])(
    'rejects the title %j',
    (title) => {
      expect(SuggestedTopicSchema.safeParse({ ...topic, title }).success).toBe(false);
    },
  );

  it('accepts a 120-character title', () => {
    expect(SuggestedTopicSchema.safeParse({ ...topic, title: 'a'.repeat(120) }).success).toBe(true);
  });

  it('rejects an unknown style', () => {
    expect(SuggestedTopicSchema.safeParse({ ...topic, style: 'poem' }).success).toBe(false);
  });

  it('rejects a bad interest slug', () => {
    expect(SuggestedTopicSchema.safeParse({ ...topic, interest: 'Deep Space' }).success).toBe(false);
  });

  it('rejects a missing interest and an extra key', () => {
    const withoutInterest = { title: topic.title, style: topic.style };
    expect(SuggestedTopicSchema.safeParse(withoutInterest).success).toBe(false);
    expect(SuggestedTopicSchema.safeParse({ ...topic, extra: 1 }).success).toBe(false);
  });
});

describe('SuggestedTopicsSchema', () => {
  it('accepts any count up to 20, including a short batch', () => {
    expect(SuggestedTopicsSchema.safeParse({ topics: [topic] }).success).toBe(true);
    expect(SuggestedTopicsSchema.safeParse({ topics: Array(20).fill(topic) }).success).toBe(true);
  });

  it('rejects 21 topics', () => {
    expect(SuggestedTopicsSchema.safeParse({ topics: Array(21).fill(topic) }).success).toBe(false);
  });

  it('rejects a bad topic and an extra key', () => {
    expect(SuggestedTopicsSchema.safeParse({ topics: [{ ...topic, style: 'x' }] }).success).toBe(false);
    expect(SuggestedTopicsSchema.safeParse({ topics: [], extra: 1 }).success).toBe(false);
  });
});

describe('TopicsQuerySchema', () => {
  it('accepts no filter, a style, ready as text, or both', () => {
    expect(TopicsQuerySchema.safeParse({}).success).toBe(true);
    expect(TopicsQuerySchema.safeParse({ style: 'facts' }).success).toBe(true);
    expect(TopicsQuerySchema.safeParse({ ready: 'true' }).success).toBe(true);
    expect(TopicsQuerySchema.safeParse({ ready: 'false', style: 'history' }).success).toBe(true);
  });

  it('accepts heard as text, alone or with ready, and rejects other values', () => {
    expect(TopicsQuerySchema.safeParse({ heard: 'true' }).success).toBe(true);
    expect(TopicsQuerySchema.safeParse({ heard: 'false', ready: 'false' }).success).toBe(true);
    expect(TopicsQuerySchema.safeParse({ heard: true }).success).toBe(false);
    expect(TopicsQuerySchema.safeParse({ heard: 'all' }).success).toBe(false);
  });

  it('rejects an unknown style, a non-text ready, other words and an unknown key', () => {
    expect(TopicsQuerySchema.safeParse({ style: 'x' }).success).toBe(false);
    expect(TopicsQuerySchema.safeParse({ ready: true }).success).toBe(false);
    expect(TopicsQuerySchema.safeParse({ ready: '1' }).success).toBe(false);
    expect(TopicsQuerySchema.safeParse({ limit: '5' }).success).toBe(false);
  });
});

describe('TopicRowSchema', () => {
  const rowId = '00000000-0000-4000-8000-000000000001';
  const base = { id: rowId, title: 'Тема', style: 'facts', inQueue: false, heard: false };

  it('accepts a ready row with a positive integer duration', () => {
    expect(TopicRowSchema.safeParse({ ...base, state: 'ready', durationSec: 600 }).success).toBe(true);
  });

  it.each(['creating', 'failed', 'not_ready'])('accepts a %s row with a null duration', (state) => {
    expect(TopicRowSchema.safeParse({ ...base, state, durationSec: null }).success).toBe(true);
  });

  it('rejects a ready row without a usable duration', () => {
    expect(TopicRowSchema.safeParse({ ...base, state: 'ready', durationSec: null }).success).toBe(false);
    expect(TopicRowSchema.safeParse({ ...base, state: 'ready', durationSec: 0 }).success).toBe(false);
    expect(TopicRowSchema.safeParse({ ...base, state: 'ready', durationSec: 1.5 }).success).toBe(false);
    expect(TopicRowSchema.safeParse({ ...base, state: 'ready' }).success).toBe(false);
  });

  it('rejects a duration on a row that is not ready', () => {
    expect(TopicRowSchema.safeParse({ ...base, state: 'not_ready', durationSec: 600 }).success).toBe(false);
    expect(TopicRowSchema.safeParse({ ...base, state: 'failed' }).success).toBe(false);
  });

  it('requires heard as a boolean on both shapes', () => {
    expect(TopicRowSchema.safeParse({ ...base, heard: true, state: 'ready', durationSec: 600 }).success).toBe(true);
    expect(TopicRowSchema.safeParse({ ...base, heard: true, state: 'failed', durationSec: null }).success).toBe(true);
    for (const row of [
      { state: 'ready', durationSec: 600 },
      { state: 'not_ready', durationSec: null },
    ]) {
      const copy: Record<string, unknown> = { ...base, ...row };
      delete copy['heard'];
      expect(TopicRowSchema.safeParse(copy).success).toBe(false);
    }
  });

  it('rejects an unknown state, a missing inQueue and an extra key (no audio URL, no story id)', () => {
    expect(TopicRowSchema.safeParse({ ...base, state: 'done', durationSec: null }).success).toBe(false);
    expect(
      TopicRowSchema.safeParse({ id: rowId, title: 'T', style: 'facts', heard: false, state: 'not_ready', durationSec: null })
        .success,
    ).toBe(false);
    expect(
      TopicRowSchema.safeParse({ ...base, state: 'ready', durationSec: 600, audioUrl: 'https://x.test' }).success,
    ).toBe(false);
  });
});

describe('TopicsResponseSchema', () => {
  it('accepts an empty list and rejects an extra key', () => {
    expect(TopicsResponseSchema.safeParse({ topics: [] }).success).toBe(true);
    expect(TopicsResponseSchema.safeParse({ topics: [], next: 'x' }).success).toBe(false);
  });
});
