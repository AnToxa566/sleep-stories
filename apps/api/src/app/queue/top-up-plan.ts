import { MAX_SUGGESTED_PER_JOB, QUEUE_TARGET_LENGTH, QUEUE_TOP_UP_THRESHOLD } from './queue-policy';

export interface TopUpPlanInput {
  queueLength: number;
  suggestionsLeft: number;
  // Candidate ids, already random-ordered by the caller.
  ready: readonly string[];
  withoutAudio: readonly string[];
  withoutStory: readonly string[];
}

export interface TopUpPlan {
  need: number;
  queueReady: string[];
  queueWithoutAudio: string[];
  queueWithoutStory: string[];
  suggestMissing: number;
}

// Negative or non-finite numbers count as 0 so a bad count can only do less, never more.
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

// Pure decision for one top-up: how many items are needed and which candidates fill them.
// Order is ready, then stories with no audio in the person's voice, then the person's own
// topics with no story; `suggest_topics` only gets what is still missing, and only if a
// suggestion slot remains. Nothing here costs a generation: the top-up only fills the queue
// (ARCHITECTURE.md section 6, "Queue top-up"). The total of the three lists never exceeds
// the need.
export function planTopUp(input: TopUpPlanInput): TopUpPlan {
  const queueLength = count(input.queueLength);
  const need =
    queueLength > QUEUE_TOP_UP_THRESHOLD ? 0 : Math.max(0, QUEUE_TARGET_LENGTH - queueLength);

  let remaining = need;

  const queueReady = input.ready.slice(0, remaining);
  remaining -= queueReady.length;

  const queueWithoutAudio = input.withoutAudio.slice(0, remaining);
  remaining -= queueWithoutAudio.length;

  const queueWithoutStory = input.withoutStory.slice(0, remaining);
  remaining -= queueWithoutStory.length;

  const canSuggest = remaining > 0 && count(input.suggestionsLeft) >= 1;
  const suggestMissing = canSuggest ? Math.min(remaining, MAX_SUGGESTED_PER_JOB) : 0;

  return { need, queueReady, queueWithoutAudio, queueWithoutStory, suggestMissing };
}
