import type { GenerationJobPayload } from '@sleep-stories/contracts';
import type { StoryState } from './story-state';

export interface StartPlanInput {
  // The person's queue items the request is about: all of them (main button) or one.
  items: readonly { itemId: string; topicId: string }[];
  // The state of each topic in the person's voice, from readStoryStates. A topic with no
  // entry is not a target.
  states: ReadonlyMap<string, StoryState>;
  voiceId: string;
  generationsLeft: number;
}

export type StartPlan =
  // Nothing to start (every item is ready or already being made). Never an error, even with
  // no generations left: a double tap must not turn into a refusal.
  | { kind: 'noop' }
  // More items to start than generations left: the whole request is refused (all-or-nothing).
  | { kind: 'refused' }
  | { kind: 'start'; payloads: GenerationJobPayload[] };

// Decides which generation jobs an explicit start creates (ARCHITECTURE.md section 6,
// "Generation is explicit", rules 3 to 6). Pure: it reads nothing and writes nothing.
//
// A target is an item whose state is `not_ready` or `failed`. A `ready` item has audio, a
// `creating` item already has an active job of its next stage (starting it again would
// only join that job), and an item with no state does not exist. One target costs one
// generation, whichever stage it needs: no story yet gives a `write_story` (the handler
// chains the render), a story without audio in the voice gives a `render_audio`.
export function planStart(input: StartPlanInput): StartPlan {
  const payloads: GenerationJobPayload[] = [];
  const seenTopics = new Set<string>();
  for (const item of input.items) {
    const state = input.states.get(item.topicId);
    if (state === undefined || (state.state !== 'not_ready' && state.state !== 'failed')) {
      continue;
    }
    // One topic is one generation, even if it were in the queue twice.
    if (seenTopics.has(item.topicId)) {
      continue;
    }
    seenTopics.add(item.topicId);
    payloads.push(payloadFor(item.topicId, state, input.voiceId));
  }
  if (payloads.length === 0) {
    return { kind: 'noop' };
  }
  if (payloads.length > input.generationsLeft) {
    return { kind: 'refused' };
  }
  return { kind: 'start', payloads };
}

function payloadFor(topicId: string, state: StoryState, voiceId: string): GenerationJobPayload {
  return state.storyId === null
    ? { kind: 'write_story', topicId, voiceId }
    : { kind: 'render_audio', storyId: state.storyId, voiceId };
}
