import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';

const LockedRowsSchema = z.array(z.object({ id: z.uuid() }));

// Locks one person's `users` row until the transaction ends (`FOR UPDATE`). It is the lock
// that orders the top-up, the queue edits, the explicit start, the suggestion step and
// onboarding of one person against each other (ARCHITECTURE.md section 6). Take it FIRST in
// a transaction, before any other row lock, so the order of locks is always `users`, then
// `queue_items`.
//
// Returns whether the row exists. A token for a person with no `users` row locks nothing;
// the callers that care (the top-up, the suggestion step) turn `false` into their own answer.
//
// The query text is a contract: the integration tests find a waiting lock request in
// `pg_stat_activity` by matching `FROM users ... FOR UPDATE`. `architecture.spec.ts` keeps
// this file the only place where that text is written.
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const rows = LockedRowsSchema.parse(
    await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
  );
  return rows.length > 0;
}
