import type { QueueItem, TopicRow } from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../strings';
import { formatDuration } from '../today/plural';

// Pure helpers for the lists «Темы» and «Замена». No React Native.

export interface TopicRowView {
  readonly id: string;
  readonly title: string;
  readonly styleLabel: string;
  readonly state: TopicRow['state'];
  readonly inQueue: boolean;
  // The person has heard this story: the title is muted and the data line ends with «✓ Прослушана».
  readonly heard: boolean;
  // «2:31» for a ready topic, otherwise null.
  readonly durationText: string | null;
  // The status word of a creating or failed topic, otherwise null.
  readonly statusLabel: string | null;
  // «~3 мин» for a creating topic, otherwise null.
  readonly statusDetail: string | null;
  // True for «Не готова»: the row offers the hint sheet.
  readonly hint: boolean;
}

export function deriveTopicRow(topic: TopicRow): TopicRowView {
  const copy = strings.topics.row;
  const base = {
    id: topic.id,
    title: topic.title,
    styleLabel: styleCopy[topic.style].label,
    state: topic.state,
    inQueue: topic.inQueue,
    heard: topic.heard,
  };
  switch (topic.state) {
    case 'ready':
      return {
        ...base,
        durationText: formatDuration(topic.durationSec),
        statusLabel: null,
        statusDetail: null,
        hint: false,
      };
    case 'not_ready':
      return { ...base, durationText: null, statusLabel: null, statusDetail: null, hint: true };
    case 'creating':
      return {
        ...base,
        durationText: null,
        statusLabel: copy.creating,
        statusDetail: copy.creatingEstimate,
        hint: false,
      };
    case 'failed':
      return {
        ...base,
        durationText: null,
        statusLabel: copy.failed,
        statusDetail: null,
        hint: false,
      };
  }
}

// topic id -> id of the queue item that holds it, so a tap on ✓ can remove the right item.
// A topic is in a queue once; if it ever were twice, the first (earliest) item is used.
export function queueItemIdByTopic(items: readonly QueueItem[]): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const item of items) {
    if (!lookup.has(item.topicId)) lookup.set(item.topicId, item.id);
  }
  return lookup;
}

// The plate «В очереди: N» is shown only when the queue holds something.
export function showQueuePlate(count: number): boolean {
  return count >= 1;
}

export function queuePlateText(count: number): string {
  return strings.topics.plate.inQueue(count);
}

// «Замена» lists the topics that are not in the queue yet. The topic of the item being replaced
// is in the queue, so it is excluded with the rest.
export function replaceCandidates(topics: readonly TopicRow[]): TopicRow[] {
  return topics.filter((topic) => !topic.inQueue);
}
