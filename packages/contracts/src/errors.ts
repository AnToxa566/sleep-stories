import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'unauthorized',
  'auth_unavailable',
  'validation_failed',
  'unknown_voice',
  'unknown_interest',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.strictObject({
  statusCode: z.number().int().min(400).max(599),
  code: ApiErrorCodeSchema,
  message: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
