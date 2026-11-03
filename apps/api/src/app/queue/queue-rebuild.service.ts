import { Injectable } from '@nestjs/common';
import type { QueueResponse } from '@sleep-stories/contracts';
import { lockUserRow } from '../prisma/lock-user-row';
import { PrismaService } from '../prisma/prisma.service';
import { findReady, findWithoutAudio, findWithoutStory } from './queue-candidates';
import { QUEUE_TARGET_LENGTH } from './queue-policy';
import { QueueReadService } from './queue-read.service';
import { replaceQueue } from './queue-replace';
import { QueueTopUpService } from './queue-top-up.service';

// «Пересобрать очередь» (owner decision, 2026-11-03): the person's whole queue is thrown away
// and rebuilt from UNHEARD stories. There is no undo.
//
// One transaction behind the `users` row lock: find, delete, insert. The finders are the ones
// of the top-up and the picks, so the same privacy rules apply (never a topic anybody typed,
// SECURITY.md rule 10), and the order is the top-up's: ready stories first, then stories
// without audio in the person's voice, then the person's own proposed topics with no story.
// `includeQueued` because the queue is about to be deleted, so what is in it now is a
// candidate like any other; `includeOwn` as in «continue», so a story made for the person's
// own topic stays reachable. `heard` is 'exclude' on purpose, named here so it is not an
// accident of a default.
//
// When fewer than the target length were found, the top-up runs after the commit, in its own
// transaction and lock, exactly as in the none-ready path of «continue». The answer is read
// after that, so `collecting` is the one `GET /api/queue` reports.
//
// This starts no story or audio work and spends no generation (AGENTS.md architecture rule
// 10). The only job that can come out of it is the top-up's topic suggestion, within its cap.
@Injectable()
export class QueueRebuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: QueueReadService,
    private readonly topUp: QueueTopUpService,
  ) {}

  // `userId` comes from the verified token only.
  async run(userId: string): Promise<QueueResponse> {
    const queued = await this.replaceWithUnheard(userId);
    if (queued < QUEUE_TARGET_LENGTH) {
      await this.topUp.run(userId);
    }
    return this.reader.read(userId);
  }

  // Returns how many items the queue holds afterwards. A person without a `users` row or
  // without preferences has nothing to rebuild: nothing is touched and 0 is returned.
  private async replaceWithUnheard(userId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockUserRow(tx, userId))) {
        return 0;
      }
      const preferences = await tx.userPreference.findUnique({
        where: { userId },
        select: { voiceId: true },
      });
      if (preferences === null) {
        return 0;
      }
      const base = {
        userId,
        voiceId: preferences.voiceId,
        includeQueued: true,
        includeOwn: true,
        heard: 'exclude' as const,
        order: 'newest' as const,
      };
      const ready = await findReady(tx, { ...base, limit: QUEUE_TARGET_LENGTH });
      const topicIds = new Set(ready.map((row) => row.topicId));

      const withoutAudio = await findWithoutAudio(tx, {
        ...base,
        limit: QUEUE_TARGET_LENGTH - topicIds.size,
      });
      withoutAudio.forEach((row) => topicIds.add(row.topicId));

      const withoutStory = await findWithoutStory(tx, {
        ...base,
        limit: QUEUE_TARGET_LENGTH - topicIds.size,
      });
      withoutStory.forEach((topicId) => topicIds.add(topicId));

      return replaceQueue(tx, userId, [...topicIds].slice(0, QUEUE_TARGET_LENGTH));
    });
  }
}
