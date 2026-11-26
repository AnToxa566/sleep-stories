import type { JobKind } from '@sleep-stories/contracts';

// Limits of generation and the numbers of generation jobs. Decided by the owner on
// 2026-10-30 and reworded on 2026-10-31 (ARCHITECTURE.md section 6, "Generation is explicit"
// and "How jobs run"). The lease of a job is in `providers/job-queue/job-lease.ts`, because
// the job queue adapter needs it too.

// Generations one person may use per window. One generation is bringing one story to ready:
// a `write_story` and the `render_audio` that follows it, or a `render_audio` alone, count as
// one. Only an explicit start (GenerationStartService) spends one.
export const MAX_GENERATIONS_PER_WINDOW = 5;

// `suggest_topics` runs one person may use per window.
export const MAX_SUGGESTIONS_PER_WINDOW = 5;

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

// The sweeper re-enqueues a `pending` job older than this (its enqueue failed or its task
// was lost). Decided by the owner on 2026-10-30. Two minutes is longer than a normal
// enqueue-to-claim delay, so a healthy job is rarely enqueued twice (the claim makes a
// double enqueue harmless anyway).
export const SWEEP_PENDING_AFTER_MINUTES = 2;

// Most jobs one sweep call re-enqueues. Decided by the owner on 2026-10-30. Bounds the work
// of one scheduler call; the next call takes the rest.
export const SWEEP_BATCH_SIZE = 50;
