import type { StoryState, StoryStateName } from './story-state';
import { planStart } from './generation-start-plan';

const VOICE = '00000000-0000-4000-8000-0000000000aa';
const topic = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const story = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
const item = (n: number) => ({ itemId: `30000000-0000-4000-8000-00000000000${n}`, topicId: topic(n) });

function state(name: StoryStateName, storyId: string | null = null): StoryState {
  return { state: name, storyId, durationSec: null, storagePath: null };
}
const states = (entries: [number, StoryState][]) =>
  new Map(entries.map(([n, value]) => [topic(n), value]));

const plan = (items: ReturnType<typeof item>[], entries: [number, StoryState][], generationsLeft: number) =>
  planStart({ items, states: states(entries), voiceId: VOICE, generationsLeft });

describe('planStart', () => {
  it('writes a story for a not_ready item without a story', () => {
    expect(plan([item(1)], [[1, state('not_ready')]], 5)).toEqual({
      kind: 'start',
      payloads: [{ kind: 'write_story', topicId: topic(1), voiceId: VOICE }],
    });
  });

  it('renders the audio for a not_ready item that has a story', () => {
    expect(plan([item(1)], [[1, state('not_ready', story(1))]], 5)).toEqual({
      kind: 'start',
      payloads: [{ kind: 'render_audio', storyId: story(1), voiceId: VOICE }],
    });
  });

  it('writes again for a failed item without a story', () => {
    expect(plan([item(1)], [[1, state('failed')]], 1)).toEqual({
      kind: 'start',
      payloads: [{ kind: 'write_story', topicId: topic(1), voiceId: VOICE }],
    });
  });

  it('renders again for a failed item that has a story', () => {
    expect(plan([item(1)], [[1, state('failed', story(1))]], 1)).toEqual({
      kind: 'start',
      payloads: [{ kind: 'render_audio', storyId: story(1), voiceId: VOICE }],
    });
  });

  it('skips ready, creating and stateless items', () => {
    const result = plan(
      [item(1), item(2), item(3), item(4)],
      [
        [1, state('ready', story(1))],
        [2, state('creating')],
        [4, state('not_ready')],
      ],
      5,
    );
    expect(result).toEqual({
      kind: 'start',
      payloads: [{ kind: 'write_story', topicId: topic(4), voiceId: VOICE }],
    });
  });

  it('is a no-op when there is nothing to start', () => {
    expect(plan([item(1), item(2)], [[1, state('ready', story(1))], [2, state('creating')]], 5)).toEqual({
      kind: 'noop',
    });
  });

  it('is a no-op for an empty queue', () => {
    expect(plan([], [], 5)).toEqual({ kind: 'noop' });
  });

  it('is a no-op, not a refusal, with nothing left and nothing to start', () => {
    expect(plan([item(1)], [[1, state('creating')]], 0)).toEqual({ kind: 'noop' });
    expect(plan([item(1)], [[1, state('ready', story(1))]], 0)).toEqual({ kind: 'noop' });
  });

  it('refuses when there are more targets than generations left', () => {
    const entries: [number, StoryState][] = [
      [1, state('not_ready')],
      [2, state('failed', story(2))],
      [3, state('not_ready')],
    ];
    expect(plan([item(1), item(2), item(3)], entries, 2)).toEqual({ kind: 'refused' });
  });

  it('refuses a single target at zero left', () => {
    expect(plan([item(1)], [[1, state('not_ready')]], 0)).toEqual({ kind: 'refused' });
  });

  it('starts when the targets equal the generations left', () => {
    const result = plan([item(1), item(2)], [[1, state('not_ready')], [2, state('not_ready')]], 2);
    expect(result.kind).toBe('start');
  });

  it('counts only targets against the limit, not the skipped items', () => {
    const result = plan(
      [item(1), item(2), item(3)],
      [[1, state('ready', story(1))], [2, state('creating')], [3, state('not_ready')]],
      1,
    );
    expect(result.kind).toBe('start');
  });

  it('plans one job for a topic queued twice', () => {
    const twice = [item(1), { itemId: item(2).itemId, topicId: topic(1) }];
    const result = plan(twice, [[1, state('not_ready')]], 1);
    expect(result).toMatchObject({ kind: 'start', payloads: [{ kind: 'write_story' }] });
  });
});
