import { Injectable, Logger } from '@nestjs/common';
import {
  GenerationJobPayloadSchema,
  JobKindSchema,
  type JobKind,
} from '@sleep-stories/contracts';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_LEASE_MINUTES, MAX_ATTEMPTS } from '../queue/queue-policy';
import { classifyFailure } from './classify-failure';
import { JobHandlerRegistry, JobLeaseLostError, type JobContext } from './job-handler';

// What one call of `run` ended with. The HTTP layer maps `retry` and `in_progress` to 503
// (the queue delivers again later) and everything else to 200.
// - succeeded: the handler ran and marked the job succeeded.
// - failed: the job failed for good (it frees its slot and removes nothing from any queue).
// - finished: nothing to do or nothing more to do here: the job is done or dropped, or
//   another run owns it now.
// - retry: the attempt failed with a retryable error; the job is `pending` again.
// - in_progress: another run holds a live lease.
export type RunOutcome = 'succeeded' | 'failed' | 'finished' | 'retry' | 'in_progress';

const ClaimedRowSchema = z.object({
  id: z.uuid(),
  kind: JobKindSchema,
  payload: z.unknown(),
  requested_by_user_id: z.uuid().nullable(),
  attempts: z.number().int(),
});

const JobRowSchema = z.object({
  kind: JobKindSchema,
  payload: z.unknown(),
  requested_by_user_id: z.uuid().nullable(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  attempts: z.number().int(),
  lease_fresh: z.boolean(),
});

// The run a claim produced. `attempt` is the value of `attempts` this run wrote; every later
// write of the run is conditioned on it (the fence).
interface ClaimedRun {
  id: string;
  kind: JobKind;
  userId: string | null;
  attempt: number;
}

// Which jobs a final failure may take. A claimed run owns a `running` row; the crash-on-
// the-last-attempt path finalises a job nobody holds (pending, or running past the lease).
type Fence = 'running' | 'any_active';

const fenceSql = (fence: Fence, attempt: number): Prisma.Sql =>
  fence === 'running'
    ? Prisma.sql`status = 'running' AND attempts = ${attempt}::int`
    : Prisma.sql`status IN ('pending', 'running') AND attempts = ${attempt}::int`;

// The per-kind attempts limit as a SQL expression, with the numbers as parameters.
const maxAttemptsSql = (): Prisma.Sql => Prisma.sql`
  CASE kind::text
    WHEN 'write_story' THEN ${MAX_ATTEMPTS.write_story}::int
    WHEN 'render_audio' THEN ${MAX_ATTEMPTS.render_audio}::int
    WHEN 'suggest_topics' THEN ${MAX_ATTEMPTS.suggest_topics}::int
  END
`;

// Runs one generation job exactly once at a time (ARCHITECTURE.md section 6, "How jobs run"
// and section 11 items 13 and 20).
// - Claim: one UPDATE takes a `pending` job, or a `running` one whose lease expired, and
//   counts the attempt. Two overlapping deliveries cannot both win it.
// - Fence: every later write of this run is conditioned on `status = 'running'` and the
//   attempt number it claimed, so a slow run whose lease was taken over can neither mark
//   success nor fail the job (and its transaction rolls back).
// - Failure: a retryable error with attempts left releases the job; anything else fails it
//   for good, with a fixed code in `last_error` (never error text). A failed job frees its
//   slot and removes nothing from any queue (owner, 2026-10-31).
// Logging is limited to one fixed line per outcome class: no ids, no codes, no error text.
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlers: JobHandlerRegistry,
  ) {}

  async run(jobId: string): Promise<RunOutcome> {
    // No handler for the kind (a deployment gap): touch nothing and answer `retry`, so the
    // queue delivers again later. Failing the job instead would mark it failed for good (and
    // keep its topic from being offered again) because of the deployment, not a failure of
    // the job. Checked before the claim, so no attempt is counted either.
    if (await this.lacksHandler(jobId)) {
      return 'retry';
    }
    const claimed = await this.claim(jobId);
    if (claimed === null) {
      return this.afterFailedClaim(jobId);
    }
    const run: ClaimedRun = {
      id: claimed.id,
      kind: claimed.kind,
      userId: claimed.requested_by_user_id,
      attempt: claimed.attempts,
    };

    // The stored payload includes `kind`; it must also agree with the `kind` column.
    const parsed = GenerationJobPayloadSchema.safeParse(claimed.payload);
    if (!parsed.success || parsed.data.kind !== run.kind) {
      return this.failForGood(run, 'running', 'invalid_payload');
    }
    const payload = parsed.data;

    const handler = this.handlers.get(run.kind);
    if (handler === undefined) {
      // Cannot happen: lacksHandler() checked the same registry, which never changes.
      // If it ever does, hand the claim back instead of failing the job.
      return this.release(run);
    }

    let completed = false;
    const context: JobContext = {
      job: {
        id: run.id,
        kind: run.kind,
        userId: run.userId,
        payload,
        attempt: run.attempt,
      },
      markSucceeded: async (tx) => {
        await this.markSucceeded(tx, run);
        completed = true;
      },
    };

    try {
      await handler.run(context);
    } catch (error) {
      return this.afterHandlerError(run, error);
    }
    if (!completed) {
      // A programming error in the handler: it returned without marking the job.
      return this.failForGood(run, 'running', 'handler_did_not_complete');
    }
    return 'succeeded';
  }

  // True when the job is active (pending or running) and no handler is registered for its
  // kind. A missing, finished or failed job is not "lacking a handler": it goes on to the
  // claim, which reports it as finished.
  private async lacksHandler(jobId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT kind::text AS kind
      FROM generation_jobs
      WHERE id = ${jobId}::uuid AND status IN ('pending', 'running')
    `;
    if (rows.length === 0) {
      return false;
    }
    const { kind } = z.object({ kind: JobKindSchema }).parse(rows[0]);
    return this.handlers.get(kind) === undefined;
  }

  // The claim. `attempts < max(kind)` keeps a job that used its attempts from running again.
  private async claim(jobId: string): Promise<z.infer<typeof ClaimedRowSchema> | null> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      UPDATE generation_jobs
      SET status = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = ${jobId}::uuid
        AND (
          status = 'pending'
          OR (
            status = 'running'
            AND started_at < now() - make_interval(mins => ${JOB_LEASE_MINUTES}::int)
          )
        )
        AND attempts < ${maxAttemptsSql()}
      RETURNING id, kind, payload, requested_by_user_id, attempts
    `;
    return rows.length === 0 ? null : ClaimedRowSchema.parse(rows[0]);
  }

  // Nothing was claimed: find out why.
  private async afterFailedClaim(jobId: string): Promise<RunOutcome> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT kind, payload, requested_by_user_id, status::text AS status, attempts,
        (
          status = 'running'
          AND started_at >= now() - make_interval(mins => ${JOB_LEASE_MINUTES}::int)
        ) AS lease_fresh
      FROM generation_jobs
      WHERE id = ${jobId}::uuid
    `;
    if (rows.length === 0) {
      return 'finished';
    }
    const job = JobRowSchema.parse(rows[0]);
    if (job.status === 'succeeded' || job.status === 'failed') {
      return 'finished';
    }
    if (job.lease_fresh) {
      return 'in_progress';
    }
    if (job.attempts >= MAX_ATTEMPTS[job.kind]) {
      // A run crashed on the last attempt and its lease expired: nobody can claim the job
      // again, so close it.
      return this.failForGood(
        { id: jobId, kind: job.kind, userId: job.requested_by_user_id, attempt: job.attempts },
        'any_active',
        'attempts_exhausted',
      );
    }
    // The row changed between the claim and this read (someone else claimed it).
    return 'in_progress';
  }

  // Called by the handler inside its own transaction. Fenced: exactly one row must match.
  private async markSucceeded(tx: Prisma.TransactionClient, run: ClaimedRun): Promise<void> {
    // A PrismaClient has `$connect`; the client of an interactive transaction does not
    // (checked against Prisma 7: `$transaction` exists on both, `$connect` only on the
    // full client). Without a transaction the job's success would not commit together with
    // the handler's rows.
    if (typeof (tx as { $connect?: unknown }).$connect === 'function') {
      throw new Error('markSucceeded needs a transaction client');
    }
    const rows = await tx.$queryRaw<unknown[]>`
      UPDATE generation_jobs
      SET status = 'succeeded', finished_at = now()
      WHERE id = ${run.id}::uuid AND ${fenceSql('running', run.attempt)}
      RETURNING id
    `;
    if (rows.length !== 1) {
      throw new JobLeaseLostError();
    }
  }

  private async afterHandlerError(
    run: ClaimedRun,
    error: unknown,
  ): Promise<RunOutcome> {
    if (error instanceof JobLeaseLostError) {
      // Someone else owns the job now: change nothing, apply no policy.
      return 'finished';
    }
    const failure = classifyFailure(error);
    if (failure.retryable && run.attempt < MAX_ATTEMPTS[run.kind]) {
      return this.release(run);
    }
    return this.failForGood(run, 'running', failure.code);
  }

  // Back to `pending` for the next delivery. Fenced: a lost lease changes nothing.
  private async release(run: ClaimedRun): Promise<RunOutcome> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      UPDATE generation_jobs
      SET status = 'pending', started_at = NULL
      WHERE id = ${run.id}::uuid AND ${fenceSql('running', run.attempt)}
      RETURNING id
    `;
    if (rows.length === 0) {
      return 'finished';
    }
    this.logger.warn('A job attempt failed and the job will be retried');
    return 'retry';
  }

  // The job fails for good. `code` is from the fixed vocabulary; it is the only thing
  // stored. Failure policy (owner, 2026-10-31): the job becomes `failed`, which frees its
  // generation slot, and nothing is removed from any queue; the item stays and shows the
  // failed state. The update is fenced: a lost lease changes nothing.
  private async failForGood(run: ClaimedRun, fence: Fence, code: string): Promise<RunOutcome> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      UPDATE generation_jobs
      SET status = 'failed', finished_at = now(), last_error = ${code}::text
      WHERE id = ${run.id}::uuid AND ${fenceSql(fence, run.attempt)}
      RETURNING id
    `;
    if (rows.length === 0) {
      return 'finished';
    }
    this.logger.warn('A job failed for good');
    return 'failed';
  }
}
