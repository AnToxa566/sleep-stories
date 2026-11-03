import type { StoryStyle, TopicRow } from '@sleep-stories/contracts';
import type { StoryState } from './story-state';

// The hard cap on the «Темы» list. No pagination in the MVP (cycle 4b plan, default 7).
export const TOPICS_LIST_MAX = 200;

export interface TopicInfo {
  title: string;
  style: StoryStyle;
  createdAt: Date;
}

// Turns the candidate ids and the three lookups into the rows of the list. Pure, so the rules
// are tested without a database:
// - a topic with no `topics` row (deleted between the two reads) is skipped;
// - a topic with no state row is shown as `not_ready`, never as ready (same as the queue);
// - a topic whose generation finally failed is hidden unless it is in the queue (so the
//   person sees it where they can retry or remove it, and the list does not fill with dead
//   topics; ARCHITECTURE.md section 6, "Generation is explicit", rule 9);
// - `readyOnly` true keeps only ready rows, false only the rest, undefined keeps all;
// - `heard` marks the rows whose topic the person has heard (the set is made by `heard.ts`);
//   which rows are present (heard only, unheard only, both) is decided by the finders, not here;
// - order: unheard rows first, then heard ones; inside each group ready first, then newest
//   topic first, then id, so the order is stable;
// - at most TOPICS_LIST_MAX rows, cut after the order is applied. The finders already cut
//   their own results at the same number before this function sees them (see TopicsService).
export function buildTopicRows(input: {
  ids: readonly string[];
  topics: ReadonlyMap<string, TopicInfo>;
  states: ReadonlyMap<string, StoryState>;
  queued: ReadonlySet<string>;
  heard: ReadonlySet<string>;
  readyOnly?: boolean;
}): TopicRow[] {
  const seen = new Set<string>();
  const rows: { row: TopicRow; createdAt: number }[] = [];
  for (const id of input.ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const info = input.topics.get(id);
    if (info === undefined) {
      continue;
    }
    const inQueue = input.queued.has(id);
    const state = input.states.get(id);
    const common = {
      id,
      title: info.title,
      style: info.style,
      inQueue,
      heard: input.heard.has(id),
    };
    let row: TopicRow;
    if (state?.state === 'ready' && state.durationSec !== null) {
      row = { ...common, state: 'ready', durationSec: state.durationSec };
    } else {
      const name = state === undefined || state.state === 'ready' ? 'not_ready' : state.state;
      if (name === 'failed' && !inQueue) {
        continue;
      }
      row = { ...common, state: name, durationSec: null };
    }
    if (input.readyOnly !== undefined && (row.state === 'ready') !== input.readyOnly) {
      continue;
    }
    rows.push({ row, createdAt: info.createdAt.getTime() });
  }
  rows.sort((a, b) => {
    const heardOrder = Number(a.row.heard) - Number(b.row.heard);
    if (heardOrder !== 0) {
      return heardOrder;
    }
    const readyOrder = Number(b.row.state === 'ready') - Number(a.row.state === 'ready');
    if (readyOrder !== 0) {
      return readyOrder;
    }
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  });
  return rows.slice(0, TOPICS_LIST_MAX).map((entry) => entry.row);
}
