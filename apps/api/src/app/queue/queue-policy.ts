// Queue top-up and limit numbers. Decided by the owner on 2026-10-30
// (ARCHITECTURE.md section 6, "Queue top-up and the daily limit").

// A person's queue is filled up to this many items.
export const QUEUE_TARGET_LENGTH = 3;

// Top-up runs only when the queue holds this many items or fewer.
export const QUEUE_TOP_UP_THRESHOLD = 2;

// Audio renders (and the story writes that lead to one) one person may use per window.
export const MAX_RENDERS_PER_WINDOW = 5;

// `suggest_topics` runs one person may use per window.
export const MAX_SUGGESTIONS_PER_WINDOW = 3;

// Length of the rolling window for both limits, counted on the database clock.
export const LIMIT_WINDOW_HOURS = 24;

// Most topics one `suggest_topics` job may be asked for (the contract payload allows 1..3).
export const MAX_SUGGESTED_PER_JOB = 3;
