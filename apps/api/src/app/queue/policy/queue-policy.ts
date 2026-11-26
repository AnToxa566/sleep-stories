// Numbers of the night queue. Decided by the owner on 2026-10-30 and reworded on
// 2026-10-31 (ARCHITECTURE.md section 6, "Generation is explicit" and "Queue top-up").
// The limits and job numbers of generation are in `generation/policy/generation-policy.ts`.

// A person's queue is filled up to this many items.
export const QUEUE_TARGET_LENGTH = 3;

// Top-up runs only when the queue holds this many items or fewer.
export const QUEUE_TOP_UP_THRESHOLD = 2;

// How long the audio URLs in the queue response stay valid. The app downloads a ready
// story right after reading the queue, so the URL only has to outlive that download.
// Buys: a leaked URL stops working soon, and the bucket stays private. Costs: a screen left
// open longer than this holds a dead URL and must read the queue again (owner default,
// 2026-10-31).
export const QUEUE_AUDIO_URL_TTL_SECONDS = 30 * 60;
