import { z } from 'zod';

// POST /api/internal/jobs/run. The body carries the job id only: the payload is always
// read from the database row, never from the request (SECURITY.md rule 4).
export const RunJobRequestSchema = z.strictObject({
  jobId: z.uuid(),
});

// The body of a 200 answer of POST /api/internal/jobs/run. Only these three can be
// answered with 200: a retry or a job another run still holds is answered 503 with the
// error body (code `job_retry`), so the queue delivers again.
export const RunJobResponseSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed', 'finished']),
});

// POST /api/internal/jobs/sweep: how many stale jobs were handed back to the queue. Ids and
// job data never leave the server.
export const SweepJobsResponseSchema = z.strictObject({
  enqueued: z.number().int().min(0),
});

export type RunJobRequest = z.infer<typeof RunJobRequestSchema>;
export type RunJobResponse = z.infer<typeof RunJobResponseSchema>;
export type SweepJobsResponse = z.infer<typeof SweepJobsResponseSchema>;
