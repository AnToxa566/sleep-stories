import type { Prisma } from '../../generated/prisma/client';

// Replaces the person's whole queue with `topicIds`, positions 1..n in the order given. Shared
// by «continue» and the rebuild. The caller holds the `users` row lock in `tx` and has already
// found the topics, so nothing is deleted unless something is written back. A topic is queued
// once (the (user, topic) key is unique), so duplicates are dropped here. Returns how many
// items the queue holds now.
export async function replaceQueue(
  tx: Prisma.TransactionClient,
  userId: string,
  topicIds: readonly string[],
): Promise<number> {
  const unique = [...new Set(topicIds)];
  await tx.queueItem.deleteMany({ where: { userId } });
  if (unique.length > 0) {
    await tx.queueItem.createMany({
      data: unique.map((topicId, index) => ({ userId, topicId, position: index + 1 })),
    });
  }
  return unique.length;
}
