import type { QueueItem, TopicRow } from '@sleep-stories/contracts';
import {
  deriveTopicRow,
  queueItemIdByTopic,
  queuePlateText,
  replaceCandidates,
  showQueuePlate,
} from './topic-rows';

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

function topic(n: number, state: TopicRow['state'], inQueue = false): TopicRow {
  const base = { id: ID(n), title: `Topic ${n}`, style: 'facts' as const, inQueue, heard: false };
  return state === 'ready'
    ? { ...base, state, durationSec: 151 }
    : { ...base, state, durationSec: null };
}

function queueItem(n: number, topicN: number): QueueItem {
  return { id: ID(n), topicId: ID(topicN), title: `Topic ${topicN}`, style: 'facts', heard: false, state: 'not_ready' };
}

describe('deriveTopicRow', () => {
  it('shows the duration of a ready topic', () => {
    const row = deriveTopicRow(topic(1, 'ready'));
    expect(row).toMatchObject({ styleLabel: 'Факты', durationText: '2:31', hint: false });
    expect(row.statusLabel).toBeNull();
  });

  it('offers the hint for a topic that is not ready', () => {
    const row = deriveTopicRow(topic(1, 'not_ready'));
    expect(row).toMatchObject({ hint: true, durationText: null, statusLabel: null });
  });

  it('shows «Создаётся · ~2 мин» for a topic being made', () => {
    const row = deriveTopicRow(topic(1, 'creating'));
    expect(row).toMatchObject({ statusLabel: 'Создаётся', statusDetail: '~2 мин', hint: false });
  });

  it('shows plain «Не удалось» for a failed topic, with no action', () => {
    const row = deriveTopicRow(topic(1, 'failed'));
    expect(row).toMatchObject({ statusLabel: 'Не удалось', statusDetail: null, hint: false });
  });

  it('carries whether the queue holds the topic', () => {
    expect(deriveTopicRow(topic(1, 'ready', true)).inQueue).toBe(true);
    expect(deriveTopicRow(topic(1, 'ready')).inQueue).toBe(false);
  });
});

describe('queueItemIdByTopic', () => {
  it('maps a topic to the item that holds it', () => {
    const lookup = queueItemIdByTopic([queueItem(10, 1), queueItem(11, 2)]);
    expect(lookup.get(ID(1))).toBe(ID(10));
    expect(lookup.get(ID(2))).toBe(ID(11));
    expect(lookup.get(ID(3))).toBeUndefined();
  });

  it('keeps the earliest item when a topic is held twice', () => {
    const lookup = queueItemIdByTopic([queueItem(10, 1), queueItem(11, 1)]);
    expect(lookup.get(ID(1))).toBe(ID(10));
  });

  it('is empty for an empty queue', () => {
    expect(queueItemIdByTopic([]).size).toBe(0);
  });
});

describe('the queue plate', () => {
  it('shows only when the queue holds something', () => {
    expect(showQueuePlate(0)).toBe(false);
    expect(showQueuePlate(1)).toBe(true);
    expect(showQueuePlate(7)).toBe(true);
  });

  it('writes the count', () => {
    expect(queuePlateText(3)).toBe('В очереди: 3');
  });
});

describe('replaceCandidates', () => {
  it('drops the topics that are in the queue and keeps the order', () => {
    const list = [topic(1, 'ready', true), topic(2, 'not_ready'), topic(3, 'ready'), topic(4, 'failed', true)];
    expect(replaceCandidates(list).map((t) => t.id)).toEqual([ID(2), ID(3)]);
  });

  it('does not change its input', () => {
    const list = [topic(1, 'ready', true), topic(2, 'ready')];
    replaceCandidates(list);
    expect(list).toHaveLength(2);
  });
});
