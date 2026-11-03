import type { StoryState } from './story-state';
import { buildTopicRows, TOPICS_LIST_MAX, type TopicInfo } from './topic-rows';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const info = (n: number, minute = n): TopicInfo => ({
  title: `Тема ${n}`,
  style: 'facts',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});
const ready = (seconds: number): StoryState => ({
  state: 'ready',
  storyId: id(900),
  durationSec: seconds,
  storagePath: 'stories/secret/anna.mp3',
});
const plain = (state: 'creating' | 'failed' | 'not_ready'): StoryState => ({
  state,
  storyId: null,
  durationSec: null,
  storagePath: null,
});

function topicsOf(...numbers: number[]) {
  return new Map(numbers.map((n) => [id(n), info(n)] as const));
}

describe('buildTopicRows', () => {
  it('puts ready rows first, then the newest topic first', () => {
    const rows = buildTopicRows({
      ids: [id(1), id(2), id(3), id(4)],
      topics: topicsOf(1, 2, 3, 4),
      states: new Map([
        [id(1), ready(600)],
        [id(2), plain('not_ready')],
        [id(3), plain('creating')],
        [id(4), ready(300)],
      ]),
      queued: new Set(),
      heard: new Set<string>(),
    });
    expect(rows.map((row) => row.id)).toEqual([id(4), id(1), id(3), id(2)]);
  });

  it('gives a ready row its duration and every other row null', () => {
    const rows = buildTopicRows({
      ids: [id(1), id(2)],
      topics: topicsOf(1, 2),
      states: new Map([
        [id(1), ready(615)],
        [id(2), plain('creating')],
      ]),
      queued: new Set([id(2)]),
      heard: new Set<string>(),
    });
    expect(rows).toEqual([
      { id: id(1), title: 'Тема 1', style: 'facts', inQueue: false, heard: false, state: 'ready', durationSec: 615 },
      { id: id(2), title: 'Тема 2', style: 'facts', inQueue: true, heard: false, state: 'creating', durationSec: null },
    ]);
  });

  it('hides a failed topic that is not in the queue and shows one that is', () => {
    const rows = buildTopicRows({
      ids: [id(1), id(2)],
      topics: topicsOf(1, 2),
      states: new Map([
        [id(1), plain('failed')],
        [id(2), plain('failed')],
      ]),
      queued: new Set([id(2)]),
      heard: new Set<string>(),
    });
    expect(rows.map((row) => [row.id, row.state, row.inQueue])).toEqual([[id(2), 'failed', true]]);
  });

  it('shows a topic without a state row as not_ready, never as ready', () => {
    const rows = buildTopicRows({
      ids: [id(1)],
      topics: topicsOf(1),
      states: new Map(),
      queued: new Set(),
      heard: new Set<string>(),
    });
    expect(rows).toEqual([
      { id: id(1), title: 'Тема 1', style: 'facts', inQueue: false, heard: false, state: 'not_ready', durationSec: null },
    ]);
  });

  it('skips an id with no topic row and repeats of one id', () => {
    const rows = buildTopicRows({
      ids: [id(1), id(1), id(2)],
      topics: topicsOf(1),
      states: new Map(),
      queued: new Set(),
      heard: new Set<string>(),
    });
    expect(rows.map((row) => row.id)).toEqual([id(1)]);
  });

  it('keeps only ready rows for readyOnly true and only the rest for false', () => {
    const base = {
      ids: [id(1), id(2)],
      topics: topicsOf(1, 2),
      states: new Map([
        [id(1), ready(600)],
        [id(2), plain('not_ready')],
      ]),
      queued: new Set<string>(),
      heard: new Set<string>(),
    };
    expect(buildTopicRows({ ...base, readyOnly: true }).map((row) => row.id)).toEqual([id(1)]);
    expect(buildTopicRows({ ...base, readyOnly: false }).map((row) => row.id)).toEqual([id(2)]);
    expect(buildTopicRows(base)).toHaveLength(2);
  });

  it('marks heard rows and lists them after the unheard ones, ready first inside each group', () => {
    const rows = buildTopicRows({
      ids: [id(1), id(2), id(3), id(4), id(5)],
      topics: topicsOf(1, 2, 3, 4, 5),
      states: new Map([
        [id(1), ready(600)],
        [id(2), ready(600)],
        [id(3), plain('not_ready')],
        [id(4), plain('not_ready')],
        [id(5), ready(300)],
      ]),
      queued: new Set<string>(),
      heard: new Set([id(2), id(4)]),
    });
    expect(rows.map((row) => [row.id, row.heard])).toEqual([
      [id(5), false],
      [id(1), false],
      [id(3), false],
      [id(2), true],
      [id(4), true],
    ]);
  });

  it('orders equal creation times by id, so the order is stable', () => {
    const topics = new Map([
      [id(2), info(2, 5)],
      [id(1), info(1, 5)],
    ]);
    const rows = buildTopicRows({
      ids: [id(2), id(1)],
      topics,
      states: new Map(),
      queued: new Set(),
      heard: new Set<string>(),
    });
    expect(rows.map((row) => row.id)).toEqual([id(1), id(2)]);
  });

  it('cuts the list at the cap after ordering, keeping the ready rows', () => {
    const numbers = Array.from({ length: TOPICS_LIST_MAX + 5 }, (_, i) => i + 1);
    const states = new Map<string, StoryState>(numbers.map((n) => [id(n), plain('not_ready')] as const));
    states.set(id(1), ready(600)); // the oldest topic, but ready
    const rows = buildTopicRows({
      ids: numbers.map(id),
      topics: topicsOf(...numbers),
      states,
      queued: new Set(),
      heard: new Set<string>(),
    });
    expect(rows).toHaveLength(TOPICS_LIST_MAX);
    expect(rows[0].id).toBe(id(1));
    expect(rows[1].id).toBe(id(TOPICS_LIST_MAX + 5));
  });
});
