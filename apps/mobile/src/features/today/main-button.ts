import type { QueueItem, QueueResponse } from '@sleep-stories/contracts';
import { strings } from '../../strings';
import { pluralRu } from './plural';

type Generations = QueueResponse['generations'];

export type MainButtonKind = 'creating' | 'start' | 'create' | 'create-blocked';

// The sentence under the button. `link` is the «готовые истории» link that follows
// `text` in the shortage captions, and `link.tail` is the full stop after it.
export interface MainButtonCaption {
  readonly text: string;
  readonly link: { readonly label: string; readonly tail: string } | null;
}

export interface MainButtonView {
  readonly kind: MainButtonKind;
  readonly label: string;
  readonly disabled: boolean;
  // 'generate-all' is the ONLY action that may start paid generation from this button
  // (AGENTS.md architecture rule 10). 'start-player' opens the player with the ready items of the
  // queue and costs nothing. 'none' does nothing.
  readonly action: 'none' | 'generate-all' | 'start-player';
  // True while the progress fill is shown (kind 'creating').
  readonly showsProgress: boolean;
  readonly caption: MainButtonCaption;
}

export function hasCreating(items: readonly QueueItem[]): boolean {
  return items.some((item) => item.state === 'creating');
}

// Items that need a generation to become ready: not_ready and failed.
export function countNeedingGeneration(items: readonly QueueItem[]): number {
  return items.filter((item) => item.state === 'not_ready' || item.state === 'failed').length;
}

function plainCaption(text: string): MainButtonCaption {
  return { text, link: null };
}

// Decides the main button from the queue. Evaluated in order: creating, nothing to create,
// enough generations, not enough. An empty queue returns null: the empty state replaces the
// button (the screen shows no button at all).
export function deriveMainButton(
  items: readonly QueueItem[],
  generations: Generations,
): MainButtonView | null {
  if (items.length === 0) return null;
  const copy = strings.today;

  if (hasCreating(items)) {
    return {
      kind: 'creating',
      label: copy.mainButton.creating,
      disabled: true,
      action: 'none',
      showsProgress: true,
      caption: plainCaption(copy.captions.creating),
    };
  }

  const need = countNeedingGeneration(items);
  if (need === 0) {
    const totalSec = items.reduce(
      (sum, item) => sum + (item.state === 'ready' ? item.durationSec : 0),
      0,
    );
    return {
      kind: 'start',
      label: copy.mainButton.start,
      disabled: false,
      action: 'start-player',
      showsProgress: false,
      caption: plainCaption(
        copy.captions.allReady(
          items.length,
          pluralRu(items.length, copy.nouns.story),
          Math.round(totalSec / 60),
        ),
      ),
    };
  }

  const left = generations.left;
  const needNoun = pluralRu(need, copy.nouns.generation);
  if (left >= need) {
    return {
      kind: 'create',
      label: copy.mainButton.create,
      disabled: false,
      action: 'generate-all',
      showsProgress: false,
      caption: plainCaption(
        copy.captions.willCreate(
          need,
          needNoun,
          left,
          left === 1 ? copy.captions.remainingOne : copy.captions.remainingMany,
        ),
      ),
    };
  }

  return {
    kind: 'create-blocked',
    label: copy.mainButton.create,
    disabled: true,
    action: 'none',
    showsProgress: false,
    caption: {
      text: left === 0 ? copy.captions.noGenerations : copy.captions.shortage(need, needNoun, left),
      link: { label: copy.captions.readyStoriesLink, tail: copy.captions.sentenceEnd },
    },
  };
}
