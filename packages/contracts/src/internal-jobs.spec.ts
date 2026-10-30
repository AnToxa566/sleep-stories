import { RunJobRequestSchema, RunJobResponseSchema, SweepJobsResponseSchema } from './internal-jobs';

const jobId = '0b9f1c2e-4a6d-4f3b-8c1a-2d5e7f9a1b3c';

describe('RunJobRequestSchema', () => {
  it('accepts a job id', () => {
    expect(RunJobRequestSchema.safeParse({ jobId }).success).toBe(true);
  });

  it.each(['payload', 'userId', 'kind'])('rejects the extra key %s', (key) => {
    expect(RunJobRequestSchema.safeParse({ jobId, [key]: 'x' }).success).toBe(false);
  });

  it('rejects a missing, empty or non-uuid id', () => {
    expect(RunJobRequestSchema.safeParse({}).success).toBe(false);
    expect(RunJobRequestSchema.safeParse({ jobId: '' }).success).toBe(false);
    expect(RunJobRequestSchema.safeParse({ jobId: 'not-a-uuid' }).success).toBe(false);
    expect(RunJobRequestSchema.safeParse({ jobId: 42 }).success).toBe(false);
  });
});

describe('RunJobResponseSchema', () => {
  it.each(['succeeded', 'failed', 'finished'])('accepts the status %s', (status) => {
    expect(RunJobResponseSchema.safeParse({ status }).success).toBe(true);
  });

  it.each(['skipped', 'retry', 'in_progress'])('rejects %s, which is never a 200 answer', (status) => {
    expect(RunJobResponseSchema.safeParse({ status }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(RunJobResponseSchema.safeParse({ status: 'running' }).success).toBe(false);
    expect(RunJobResponseSchema.safeParse({ status: '' }).success).toBe(false);
    expect(RunJobResponseSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an extra field', () => {
    expect(RunJobResponseSchema.safeParse({ status: 'failed', error: 'boom' }).success).toBe(false);
  });
});

describe('SweepJobsResponseSchema', () => {
  it('accepts a count', () => {
    expect(SweepJobsResponseSchema.safeParse({ enqueued: 0 }).success).toBe(true);
    expect(SweepJobsResponseSchema.safeParse({ enqueued: 50 }).success).toBe(true);
  });

  it('rejects a negative or fractional count, a missing count and extra keys', () => {
    expect(SweepJobsResponseSchema.safeParse({ enqueued: -1 }).success).toBe(false);
    expect(SweepJobsResponseSchema.safeParse({ enqueued: 1.5 }).success).toBe(false);
    expect(SweepJobsResponseSchema.safeParse({}).success).toBe(false);
    expect(SweepJobsResponseSchema.safeParse({ enqueued: 1, jobIds: [] }).success).toBe(false);
  });
});
