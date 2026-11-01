import { z } from 'zod';
import { QueueResponseSchema } from './queue';

// POST /api/queue/continue (no body): the tap during the waves after the last story. The
// server replaces the person's queue with their ready, unheard stories. `ready` means such
// stories were found and the app returns to the player; `none_ready` means none were found,
// the queue is only topped up, the app goes to «Сегодня» and the server may have started only a
// topic suggestion, never a story or audio job (ARCHITECTURE.md rule 10). The answer carries
// the fresh queue so the app needs no second request.
export const ContinueOutcomeSchema = z.enum(['ready', 'none_ready']);

export const ContinueResponseSchema = z.strictObject({
  outcome: ContinueOutcomeSchema,
  queue: QueueResponseSchema,
});

export type ContinueOutcome = z.infer<typeof ContinueOutcomeSchema>;
export type ContinueResponse = z.infer<typeof ContinueResponseSchema>;
