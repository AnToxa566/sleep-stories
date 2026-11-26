import { GenerationJobPayloadSchema, JobKindSchema } from './job-payload';

const id = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const id2 = '7a1c9d2e-6b3f-4a8c-9d1e-0f2a3b4c5d6e';

describe('JobKindSchema', () => {
  it('accepts the three kinds and rejects an unknown one', () => {
    expect(JobKindSchema.options).toEqual(['suggest_topics', 'write_story', 'render_audio']);
    expect(JobKindSchema.safeParse('delete_everything').success).toBe(false);
  });
});

describe('GenerationJobPayloadSchema', () => {
  it.each([
    { kind: 'suggest_topics', missing: 2 },
    { kind: 'write_story', topicId: id, voiceId: id2 },
    { kind: 'render_audio', storyId: id, voiceId: id2 },
  ])('accepts %j', (payload) => {
    expect(GenerationJobPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects an unknown kind and a missing kind', () => {
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'nope', missing: 1 }).success).toBe(false);
    expect(GenerationJobPayloadSchema.safeParse({ missing: 1 }).success).toBe(false);
  });

  it('rejects a missing field', () => {
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'write_story', topicId: id }).success).toBe(false);
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'render_audio', voiceId: id }).success).toBe(false);
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics' }).success).toBe(false);
  });

  it('rejects an extra field on every variant', () => {
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 1, x: 1 }).success).toBe(false);
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'write_story', topicId: id, voiceId: id2, x: 1 }).success,
    ).toBe(false);
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'render_audio', storyId: id, voiceId: id2, x: 1 }).success,
    ).toBe(false);
  });

  it.each([0, 4, 1.5, -1])('rejects missing = %s without a selection', (missing) => {
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing }).success).toBe(false);
  });

  const selection = { styles: ['facts'], interestIds: [id], customInterestIds: [] };

  it('accepts a requested suggestion: missing = 0 with a selection', () => {
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 0, selection }).success,
    ).toBe(true);
    expect(
      GenerationJobPayloadSchema.safeParse({
        kind: 'suggest_topics',
        missing: 0,
        selection: { styles: ['history', 'facts'], interestIds: [], customInterestIds: [id2] },
      }).success,
    ).toBe(true);
  });

  it('rejects a selection with a queue top-up (missing above 0)', () => {
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 2, selection }).success,
    ).toBe(false);
  });

  it.each([
    { styles: [], interestIds: [id], customInterestIds: [] },
    { styles: ['facts'], interestIds: [], customInterestIds: [] },
    { styles: ['nope'], interestIds: [id], customInterestIds: [] },
    { styles: ['facts'], interestIds: ['abc'], customInterestIds: [] },
    { styles: ['facts'], interestIds: [id], customInterestIds: [], title: 'typed text' },
  ])('rejects the selection %j', (bad) => {
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 0, selection: bad }).success,
    ).toBe(false);
  });

  it('accepts missing = 1 and 3', () => {
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 1 }).success).toBe(true);
    expect(GenerationJobPayloadSchema.safeParse({ kind: 'suggest_topics', missing: 3 }).success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'write_story', topicId: 'abc', voiceId: id }).success,
    ).toBe(false);
    expect(
      GenerationJobPayloadSchema.safeParse({ kind: 'render_audio', storyId: id, voiceId: 'abc' }).success,
    ).toBe(false);
  });
});
