import { SuggestedTopicSchema, SuggestedTopicsSchema } from './topics';

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
