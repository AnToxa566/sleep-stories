import { Injectable } from '@nestjs/common';
import type { ContinueResponse } from '@sleep-stories/contracts';
import { lockUserRow } from '../prisma/lock-user-row';
import { PrismaService } from '../prisma/prisma.service';
import { findReady } from './queue-candidates';
import { QUEUE_TARGET_LENGTH } from './queue-policy';
import { QueueReadService } from './queue-read.service';
import { QueueTopUpService } from './queue-top-up.service';

// «Continue» after the last story (the tap during the waves). Owner decision (2026-11-01): the
// found stories REPLACE the queue, they are not put in front of it.
//
// The answer is read after the commit, outside the lock, as in the other queue services.
//
// This creates NO `write_story` and NO `render_audio` job and spends no generation
// (AGENTS.md architecture rule 10). The only job that can come out of it is the
// `suggest_topics` of the top-up, within its 3 per 24 hours.
@Injectable()
export class QueueContinueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: QueueReadService,
    private readonly topUp: QueueTopUpService,
  ) {}

  // `userId` comes from the verified token only.
  async run(userId: string): Promise<ContinueResponse> {
    const replaced = await this.replaceWithReady(userId);
    if (replaced) {
      return { outcome: 'ready', queue: await this.reader.read(userId) };
    }
    // Nothing ready and unheard: fill the queue from what can be found and ask for topics
    // only if some are missing (its own transaction and lock). It removes nothing, so what
    // the person still has in the queue stays.
    await this.topUp.run(userId);
    return { outcome: 'none_ready', queue: await this.reader.read(userId) };
  }

  // One transaction behind the `users` row lock: find, then delete and insert, so two
  // simultaneous calls cannot interleave and the found stories are still found when written.
  // Returns whether the queue was replaced; when nothing is found nothing is touched.
  //
  // The finder is the one of the top-up and the picks, so the same rules apply: the person's
  // styles and interests, not heard (no `listens` row), not rated -1, and never a topic that
  // anybody typed (SECURITY.md rule 10). Two options differ on purpose: `includeQueued`,
  // because the queue is replaced and a ready story already in it is still a good one, and
  // `includeOwn`, because a story made for the person's own topic is theirs to hear again
  // later. `newest` makes the order stable: the freshest story plays first.
  private async replaceWithReady(userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockUserRow(tx, userId))) {
        return false;
      }
      const preferences = await tx.userPreference.findUnique({
        where: { userId },
        select: { voiceId: true },
      });
      if (preferences === null) {
        return false;
      }
      const found = await findReady(tx, {
        userId,
        voiceId: preferences.voiceId,
        limit: QUEUE_TARGET_LENGTH,
        includeQueued: true,
        includeOwn: true,
        order: 'newest',
      });
      // Defensive: a topic is queued once (the (user, topic) key is unique).
      const topicIds = [...new Set(found.map((row) => row.topicId))];
      if (topicIds.length === 0) {
        return false;
      }
      await tx.queueItem.deleteMany({ where: { userId } });
      await tx.queueItem.createMany({
        data: topicIds.map((topicId, index) => ({ userId, topicId, position: index + 1 })),
      });
      return true;
    });
  }
}
