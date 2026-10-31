import type { JobKind } from '@sleep-stories/contracts';

// Queue top-up and limit numbers. Decided by the owner on 2026-10-30 and reworded on
// 2026-10-31 (ARCHITECTURE.md section 6, "Generation is explicit" and "Queue top-up").

// A person's queue is filled up to this many items.
export const QUEUE_TARGET_LENGTH = 3;

// Top-up runs only when the queue holds this many items or fewer.
export const QUEUE_TOP_UP_THRESHOLD = 2;

// Generations one person may use per window. One generation is bringing one story to ready:
// a `write_story` and the `render_audio` that follows it, or a `render_audio` alone, count as
// one. Only an explicit start spends one (nothing built yet creates them).
export const MAX_GENERATIONS_PER_WINDOW = 5;

// `suggest_topics` runs one person may use per window.
export const MAX_SUGGESTIONS_PER_WINDOW = 3;

// Length of the rolling window for both limits, counted on the database clock.
export const LIMIT_WINDOW_HOURS = 24;

// Most topics one `suggest_topics` job may be asked for (the contract payload allows 1..3).
export const MAX_SUGGESTED_PER_JOB = 3;

// Most claims one job may have, per kind. Decided by the owner on 2026-10-30. An attempt is
// counted at each claim, so a crash also uses one. Story writing gets three because the
// model's output can be unusable by chance; the other two get two because a retry of a paid
// call can pay again (ARCHITECTURE.md section 6).
export const MAX_ATTEMPTS = {
  write_story: 3,
  render_audio: 2,
  suggest_topics: 2,
} as const satisfies Record<JobKind, number>;

// A `running` job older than this is taken over by the next claim. Decided by the owner on
// 2026-10-30. It must be longer than the worst job (LLM 90 s + TTS 180 s + upload), so a
// live run is never taken over; it costs that a crashed run waits this long to be retaken.
export const JOB_LEASE_MINUTES = 10;

// The sweeper re-enqueues a `pending` job older than this (its enqueue failed or its task
// was lost). Decided by the owner on 2026-10-30. Two minutes is longer than a normal
// enqueue-to-claim delay, so a healthy job is rarely enqueued twice (the claim makes a
// double enqueue harmless anyway).
export const SWEEP_PENDING_AFTER_MINUTES = 2;

// Most jobs one sweep call re-enqueues. Decided by the owner on 2026-10-30. Bounds the work
// of one scheduler call; the next call takes the rest.
export const SWEEP_BATCH_SIZE = 50;

// How long the audio URLs in the queue response stay valid. The app downloads a ready
// story right after reading the queue, so the URL only has to outlive that download.
// Buys: a leaked URL stops working soon, and the bucket stays private. Costs: a screen left
// open longer than this holds a dead URL and must read the queue again (owner default,
// 2026-10-31).
export const QUEUE_AUDIO_URL_TTL_SECONDS = 30 * 60;
