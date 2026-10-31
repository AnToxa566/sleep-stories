import type { QueueItem, QueueItemState, QueueResponse } from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../strings';
import { formatDuration, formatPosition } from './plural';

type Generations = QueueResponse['generations'];

// What the row's second line offers beside the style: «Не готова» opens the hint sheet,
// «Повторить» starts one explicit generation for a failed item (rule 10).
export interface RowAction {
  readonly kind: 'hint' | 'retry';
  readonly label: string;
}

export interface RowView {
  readonly id: string;
  readonly title: string;
  readonly styleLabel: string;
  readonly state: QueueItemState;
  // «2:31» for a ready item, otherwise null.
  readonly durationText: string | null;
  // The status word of a creating or failed item («Создаётся», «Не удалось»), otherwise null.
  readonly statusLabel: string | null;
  // «~2 мин» for a creating item, otherwise null.
  readonly statusDetail: string | null;
  readonly action: RowAction | null;
  // One line for the menu header: «Факты · Не готова».
  readonly statusText: string;
}

export function deriveRow(item: QueueItem): RowView {
  const copy = strings.today.row;
  const base = {
    id: item.id,
    title: item.title,
    styleLabel: styleCopy[item.style].label,
    state: item.state,
  };

  switch (item.state) {
    case 'ready': {
      const duration = formatDuration(item.durationSec);
      return {
        ...base,
        durationText: duration,
        statusLabel: null,
        statusDetail: null,
        action: null,
        statusText: duration,
      };
    }
    case 'not_ready':
      return {
        ...base,
        durationText: null,
        statusLabel: null,
        statusDetail: null,
        action: { kind: 'hint', label: copy.notReady },
        statusText: copy.notReady,
      };
    case 'creating':
      return {
        ...base,
        durationText: null,
        statusLabel: copy.creating,
        statusDetail: copy.creatingEstimate,
        action: null,
        statusText: `${copy.creating} · ${copy.creatingEstimate}`,
      };
    case 'failed':
      return {
        ...base,
        durationText: null,
        statusLabel: copy.failed,
        statusDetail: null,
        action: { kind: 'retry', label: copy.retry },
        statusText: copy.failed,
      };
  }
}

export interface MenuEntry {
  readonly label: string;
  readonly detail: string | null;
  readonly enabled: boolean;
}

export interface MenuView {
  // «История 01»
  readonly position: string;
  readonly title: string;
  // «Факты · Не готова»
  readonly meta: string;
  // Only for not_ready and failed items (null otherwise). Inactive, with «Генераций не
  // осталось», when none are left. Active only starts ONE explicit generation (rule 10).
  readonly createNow: MenuEntry | null;
  readonly another: MenuEntry;
  // Inert for now: the topic picker is not built.
  readonly chooseFromTopics: MenuEntry;
  readonly remove: MenuEntry;
}

export function deriveMenu(item: QueueItem, index: number, generations: Generations): MenuView {
  const copy = strings.today.menu;
  const row = deriveRow(item);
  const needsGeneration = item.state === 'not_ready' || item.state === 'failed';

  let createNow: MenuEntry | null = null;
  if (needsGeneration) {
    createNow =
      generations.left > 0
        ? { label: copy.createNow, detail: copy.createNowCost(generations.left), enabled: true }
        : { label: copy.createNow, detail: copy.createNowUnavailable, enabled: false };
  }

  return {
    position: strings.today.row.position(formatPosition(index)),
    title: item.title,
    meta: `${row.styleLabel} · ${row.statusText}`,
    createNow,
    another: { label: copy.another, detail: copy.anotherHint, enabled: true },
    chooseFromTopics: { label: copy.chooseFromTopics, detail: null, enabled: false },
    remove: { label: copy.remove, detail: null, enabled: true },
  };
}

// The text of the sheet opened by a tap on «Не готова».
export function deriveHintText(generations: Generations): string {
  return strings.today.hint.body(generations.left, generations.limit);
}
