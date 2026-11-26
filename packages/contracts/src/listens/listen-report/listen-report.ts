import { z } from 'zod';

// A listen shorter than this is not recorded: a few seconds is a mis-tap or a skip past the
// story, not a listen. The server enforces it; the app may use it to skip the call.
export const LISTEN_MIN_SEC = 10;

// A story is HEARD («прослушана») when one listen of it reached this share of the duration of
// the audio in that listen's own voice. Derived from `listens` and `story_audio` and never
// stored (AGENTS.md architecture rule 4). `listened_sec` is the position when the person left;
// there is no check against seeking.
export const LISTEN_FINISHED_SHARE = 0.9;

// The column `listens.listened_sec` is a 32-bit integer; this bound only keeps a wild value
// from reaching the database. The server clamps the value to the audio duration (the real
// bound) and never trusts the client number as a duration.
export const LISTEN_REPORT_MAX_SEC = 2_147_483_647;

// POST /api/listens: one report per story, sent when the person leaves it (finished or
// skipped). The body carries no user id and no voice: the user comes from the verified JWT and
// the voice from the person's preferences (SECURITY.md rule 2). The outcome (finished or
// skipped) is derived from `listenedSec` and the duration and is never sent or stored.
// `listenedSec` is a whole number: the client rounds a fractional player position down. The
// client awaits this report before it calls POST /api/queue/continue, otherwise the story
// just heard may still count as unheard.
export const ListenReportRequestSchema = z.strictObject({
  storyId: z.uuid(),
  listenedSec: z.number().int().min(0).max(LISTEN_REPORT_MAX_SEC),
});

// `recorded` is false when the listen was below LISTEN_MIN_SEC: nothing is written. When it is
// true a `listens` row exists. Either way the queue is not touched: it changes only by the
// person's own actions.
export const ListenReportResponseSchema = z.strictObject({
  recorded: z.boolean(),
});

export type ListenReportRequest = z.infer<typeof ListenReportRequestSchema>;
export type ListenReportResponse = z.infer<typeof ListenReportResponseSchema>;
