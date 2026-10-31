import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { QueueResponse } from '@sleep-stories/contracts';
import { z } from 'zod';
import { apiErrorBody } from '../errors/api-error-body';
import { PrismaService } from '../prisma/prisma.service';
import { isSameSet } from './queue-order';
import { QueueReadService } from './queue-read.service';

// Rows with only an id: the locked `users` row, the deleted queue item.
const UserRowsSchema = z.array(z.object({ id: z.uuid() }));

// Edits to one person's queue. They only change `queue_items`: nothing here creates a
// generation job or spends a generation (AGENTS.md architecture rule 10).
//
// Each edit is one transaction behind a lock on the person's `users` row, the same lock as
// the queue top-up, so an edit and a top-up (or two edits) of one person never interleave.
// The cost: a second edit of the same person waits for the first. The response is read
// AFTER the commit, outside the lock, so the lock is not held while URLs are signed.
@Injectable()
export class QueueEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: QueueReadService,
  ) {}

  // Removes one item and closes the gap in the positions. An item that does not exist and
  // an item of another person give the same 404: the WHERE clause names both the item and
  // the person, and the answer does not say which part failed.
  async remove(userId: string, itemId: string): Promise<QueueResponse> {
    await this.prisma.$transaction(async (tx) => {
      UserRowsSchema.parse(
        await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
      );
      const deleted = UserRowsSchema.parse(
        await tx.$queryRaw<unknown[]>`
          DELETE FROM queue_items
          WHERE id = ${itemId}::uuid AND user_id = ${userId}::uuid
          RETURNING id
        `,
      );
      if (deleted.length === 0) {
        throw new NotFoundException(apiErrorBody(404, 'queue_item_not_found', 'Queue item not found'));
      }
      await tx.$executeRaw`
        UPDATE queue_items q SET position = r.rn::int
        FROM (
          SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rn
          FROM queue_items
          WHERE user_id = ${userId}::uuid
        ) r
        WHERE q.id = r.id AND q.user_id = ${userId}::uuid
      `;
    });
    return this.reader.read(userId);
  }

  // Puts the items in the sent order, positions 1..n. The sent ids must be exactly the
  // person's current ids; anything else (a stale list, a foreign id, a repeat) is a 409 and
  // nothing is written. The set is read under the lock, so it is the set the write applies to.
  async reorder(userId: string, itemIds: readonly string[]): Promise<QueueResponse> {
    await this.prisma.$transaction(async (tx) => {
      UserRowsSchema.parse(
        await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
      );
      const current = await tx.queueItem.findMany({ where: { userId }, select: { id: true } });
      if (!isSameSet(current.map((row) => row.id), itemIds)) {
        throw new ConflictException(
          apiErrorBody(409, 'queue_order_mismatch', 'The order does not match the queue'),
        );
      }
      if (itemIds.length === 0) {
        return;
      }
      await tx.$executeRaw`
        UPDATE queue_items q SET position = v.ord::int
        FROM unnest(${[...itemIds]}::uuid[]) WITH ORDINALITY AS v(id, ord)
        WHERE q.id = v.id AND q.user_id = ${userId}::uuid
      `;
    });
    return this.reader.read(userId);
  }
}
