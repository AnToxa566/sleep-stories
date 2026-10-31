import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { SUGGESTION_SHOWN_MINUTES } from './queue-policy';

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
