import type { Prisma } from '../../../generated/prisma/client';

// Adds `topicIds` to the end of the person's queue, in the order given: positions follow the
// last one in use. The one place that appends, shared by the top-up, the add from «Темы» and
// the `suggest_topics` handler. An empty list does nothing.
//
// The caller holds the `users` row lock in `tx`, so no other write of this person can take
// the same positions, and passes only topics that are not queued yet. `skipDuplicates` is for
// a caller that prefers dropping a queued topic to failing on the (user, topic) unique key;
// a dropped topic leaves a gap in the positions.
export async function appendToQueue(
  tx: Prisma.TransactionClient,
  userId: string,
  topicIds: readonly string[],
  options: { skipDuplicates?: boolean } = {},
): Promise<void> {
  if (topicIds.length === 0) {
    return;
  }
  const last = await tx.queueItem.aggregate({ where: { userId }, _max: { position: true } });
  const firstPosition = (last._max.position ?? 0) + 1;
  await tx.queueItem.createMany({
    data: topicIds.map((topicId, index) => ({ userId, topicId, position: firstPosition + index })),
    ...options,
  });
}
