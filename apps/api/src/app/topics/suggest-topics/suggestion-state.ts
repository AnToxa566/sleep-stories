import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { LIMIT_WINDOW_HOURS } from '../../generation/policy/generation-policy';

// How long an active `suggest_topics` job keeps the queue shown as "collecting" (owner,
// 2026-10-31: 5 minutes). Only a `pending` or `running` job counts, so a failed job never
// shows it. The time bound exists because a job can stay active for good: a `pending` job
// lost locally with no sweep running, or a `running` job whose process crashed. Without it
// the app would wait on an empty queue for ever. Costs: a job that really runs longer than
// this stops showing as collecting, and the empty queue shows its ordinary empty state
// until the job finishes and the next read finds the topics.
export const SUGGESTION_SHOWN_MINUTES = 5;

const ExistsRowSchema = z.object({ collecting: z.boolean() });

// True when the person has a topic-suggestion job in progress that was created recently
// (see SUGGESTION_SHOWN_MINUTES for why the time bound exists). Counts only jobs this
// person requested, on the database clock. One query, parameters only, no lock: it is a
// read for display.
export async function isCollecting(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT EXISTS (
      SELECT 1
      FROM generation_jobs
      WHERE kind = 'suggest_topics'
        AND requested_by_user_id = ${userId}::uuid
        AND status IN ('pending', 'running')
        AND created_at > now() - make_interval(mins => ${SUGGESTION_SHOWN_MINUTES}::int)
    ) AS collecting
  `;
  return ExistsRowSchema.parse(rows[0]).collecting;
}

const LatestRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
});
const NextAtRowSchema = z.object({ next_at: z.date().nullable() });

export interface LatestSuggestion {
  id: string;
  state: 'running' | 'succeeded' | 'failed';
}

// The person's newest `suggest_topics` job, whoever started it (the top-up or «Подобрать
// темы»), or null if there was none. `pending` and `running` both read as `running`: a job
// waiting for a retry is still in progress. Parameters only, no lock: a read for display, or
// a guard inside a transaction that already holds the users-row lock.
export async function readLatestSuggestion(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
): Promise<LatestSuggestion | null> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT id, status::text AS status
    FROM generation_jobs
    WHERE kind = 'suggest_topics'
      AND requested_by_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return null;
  }
  const row = LatestRowSchema.parse(rows[0]);
  const state = row.status === 'pending' || row.status === 'running' ? 'running' : row.status;
  return { id: row.id, state };
}

// When the oldest suggestion counted against the cap leaves the rolling window: the earliest
// `finished_at` of a succeeded `suggest_topics` inside the window, plus the window. Null when
// none is counted. Same rule and clock as GenerationLimitsService.usage. The caller asks only
// when nothing is left; then at least four of the five are succeeded ones (one active job at
// most per person), so the answer is not null.
export async function readNextSuggestionAt(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
): Promise<Date | null> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT min(finished_at) + make_interval(hours => ${LIMIT_WINDOW_HOURS}::int) AS next_at
    FROM generation_jobs
    WHERE kind = 'suggest_topics'
      AND requested_by_user_id = ${userId}::uuid
      AND status = 'succeeded'
      AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
  `;
  return NextAtRowSchema.parse(rows[0]).next_at;
}
