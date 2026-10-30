import { MAX_SUGGESTED_PER_JOB, QUEUE_TARGET_LENGTH, QUEUE_TOP_UP_THRESHOLD } from './queue-policy';

export interface TopUpPlanInput {
  queueLength: number;
  // Render slots still free in the window. Rendering and writing candidates share them.
  rendersLeft: number;
  suggestionsLeft: number;
  // Candidate ids, already random-ordered by the caller.
  ready: readonly string[];
  rendering: readonly string[];
  writing: readonly string[];
}

export interface TopUpPlan {
  need: number;
  queueReady: string[];
  queueRendering: string[];
  queueWriting: string[];
  suggestMissing: number;
}

// Negative or non-finite numbers count as 0 so a bad count can only do less, never more.
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

// Pure decision for one top-up: how many items are needed and which candidates fill them.
// Order is ready (free), then rendering (one render slot each), then writing (one render
// slot each); `suggest_topics` only gets what is still missing, and only if a suggestion
// slot and a render slot remain, because a suggestion with no render slot could not be
// followed by a write. The total of the three lists never exceeds the need.
export function planTopUp(input: TopUpPlanInput): TopUpPlan {
  const queueLength = count(input.queueLength);
  const need =
    queueLength > QUEUE_TOP_UP_THRESHOLD ? 0 : Math.max(0, QUEUE_TARGET_LENGTH - queueLength);

  let remaining = need;
  let renderSlots = count(input.rendersLeft);

  const queueReady = input.ready.slice(0, remaining);
  remaining -= queueReady.length;

  const queueRendering = input.rendering.slice(0, Math.min(remaining, renderSlots));
  remaining -= queueRendering.length;
  renderSlots -= queueRendering.length;

  const queueWriting = input.writing.slice(0, Math.min(remaining, renderSlots));
  remaining -= queueWriting.length;
  renderSlots -= queueWriting.length;

  const canSuggest = remaining > 0 && count(input.suggestionsLeft) >= 1 && renderSlots >= 1;
  const suggestMissing = canSuggest ? Math.min(remaining, MAX_SUGGESTED_PER_JOB) : 0;

  return { need, queueReady, queueRendering, queueWriting, suggestMissing };
}
