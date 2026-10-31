import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'unauthorized',
  'auth_unavailable',
  // /internal/jobs/run: the job is not finished or not claimable now; the queue should try again.
  'job_retry',
  'validation_failed',
  'unknown_voice',
  'unknown_interest',
  // DELETE /queue/items/:itemId: no such item for this person (a foreign id looks the same).
  'queue_item_not_found',
  // PUT /queue/order: the sent ids are not exactly the ids in the person's queue.
  'queue_order_mismatch',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.strictObject({
  statusCode: z.number().int().min(400).max(599),
  code: ApiErrorCodeSchema,
  message: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
