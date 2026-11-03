import { BadRequestException, Injectable } from '@nestjs/common';
import { QUEUE_MAX_ITEMS, type QueueResponse } from '@sleep-stories/contracts';
import { apiErrorBody } from '../errors/api-error-body';
import { lockUserRow } from '../prisma/lock-user-row';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { findEligible, findReady, findWithoutAudio, findWithoutStory } from './queue-candidates';
import { queueItemNotFound } from './queue-item-not-found';
import { QueueReadService } from './queue-read.service';
import { topicUnavailable } from './topic-unavailable';

// Choosing topics for the queue: add from «Темы», replace one item, and «Другая история».
// They change `queue_items` only. Nothing here creates a generation job, spends a generation,
// touches `generation_jobs` or writes `dismissed_at` (AGENTS.md architecture rule 10).
//
// Each method is ONE transaction: the lock on the person's `users` row first (the same lock as
// the top-up, the start and the other edits), then the eligibility check, then the write. The
// check runs under the lock so what was allowed is still allowed when the row is written. The
// answer is read after the commit, outside the lock, so URLs are not signed while it is held.
//
// Eligibility is `findEligible`, the finders of the top-up, so a topic id sent by a client is
// judged by the rules that choose topics for the queue, privacy rules included. Two of the
// top-up's rules are relaxed on purpose, because the person names the topic: an add may name a
// topic that is queued already (skipped quietly), and add and replace may name a topic whose
// generation failed (the person can start it again), and a topic whose story the person has
// heard (owner, 2026-11-03: they may want to hear it again). Every other rule stays.
// «Другая история» keeps the defaults: the server picks, and it never picks a heard story.
@Injectable()
export class QueuePickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: QueueReadService,
  ) {}

  // Appends the topics that are not queued yet, in the order sent. Any topic that is not
  // eligible fails the whole request with 404 and nothing is written.
  async add(userId: string, topicIds: readonly string[]): Promise<QueueResponse> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      const voiceId = await this.voiceOf(tx, userId);

      // A topic that is queued already is skipped quietly, even if it has stopped being
      // eligible since (rated). Only the rest is judged; one ineligible id there fails
      // the whole request.
      const current = await tx.queueItem.findMany({
        where: { userId },
        select: { topicId: true, position: true },
      });
      const queued = new Set(current.map((row) => row.topicId));
      const fresh = topicIds.filter((topicId) => !queued.has(topicId));
      const eligible = await findEligible(tx, {
        userId,
        voiceId,
        topicIds: fresh,
        includeQueued: false,
        includeFailed: true,
        includeOwn: true,
        heard: 'include',
      });
      if (fresh.some((topicId) => !eligible.has(topicId))) {
        throw topicUnavailable();
      }
      if (current.length + fresh.length > QUEUE_MAX_ITEMS) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'The queue would be too long'),
        );
      }
      if (fresh.length === 0) {
        return;
      }
      const last = current.reduce((max, row) => Math.max(max, row.position), 0);
      await tx.queueItem.createMany({
        data: fresh.map((topicId, index) => ({ userId, topicId, position: last + 1 + index })),
      });
    });
    return this.reader.read(userId);
  }

  // Puts another topic in an item. The item keeps its id, position and creation time. The
  // same topic is a 200 with no change. A topic that is in another item is 404.
  async replace(userId: string, itemId: string, topicId: string): Promise<QueueResponse> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      // The WHERE names both the item and the person: a missing id and a foreign id are the
      // same 404.
      const item = await tx.queueItem.findFirst({
        where: { id: itemId, userId },
        select: { id: true, topicId: true },
      });
      if (item === null) {
        throw queueItemNotFound();
      }
      if (item.topicId === topicId) {
        return;
      }
      const voiceId = await this.voiceOf(tx, userId);
      const eligible = await findEligible(tx, {
        userId,
        voiceId,
        topicIds: [topicId],
        includeQueued: false,
        includeFailed: true,
        includeOwn: true,
        heard: 'include',
      });
      if (!eligible.has(topicId)) {
        throw topicUnavailable();
      }
      await this.setTopic(tx, userId, itemId, topicId);
    });
    return this.reader.read(userId);
  }

  // «Другая история»: another topic of the same style as the item's current one, a ready
  // story first, then a story without audio in the person's voice, then one of the person's
  // own proposed topics with no story. The top-up's defaults apply: not queued, not failed.
  async another(userId: string, itemId: string): Promise<QueueResponse> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      const item = await tx.queueItem.findFirst({
        where: { id: itemId, userId },
        select: { id: true, topic: { select: { style: true } } },
      });
      if (item === null) {
        throw queueItemNotFound();
      }
      const voiceId = await this.voiceOf(tx, userId);
      const query = { userId, voiceId, style: item.topic.style, limit: 1 };

      const ready = await findReady(tx, query);
      const withoutAudio = ready.length === 0 ? await findWithoutAudio(tx, query) : [];
      const withoutStory =
        ready.length === 0 && withoutAudio.length === 0 ? await findWithoutStory(tx, query) : [];
      const topicId = ready[0]?.topicId ?? withoutAudio[0]?.topicId ?? withoutStory[0];
      if (topicId === undefined) {
        throw topicUnavailable();
      }
      await this.setTopic(tx, userId, itemId, topicId);
    });
    return this.reader.read(userId);
  }

  // A person without preferences has no voice and cannot pick anything: 400, as for a start.
  private async voiceOf(tx: Prisma.TransactionClient, userId: string): Promise<string> {
    const preferences = await tx.userPreference.findUnique({
      where: { userId },
      select: { voiceId: true },
    });
    if (preferences === null) {
      throw new BadRequestException(
        apiErrorBody(400, 'validation_failed', 'Onboarding is not finished'),
      );
    }
    return preferences.voiceId;
  }

  // Only `topic_id` changes; `id`, `position` and `created_at` stay. The WHERE names the
  // person again, so the write cannot touch another person's item even if the lookup is wrong.
  private async setTopic(
    tx: Prisma.TransactionClient,
    userId: string,
    itemId: string,
    topicId: string,
  ): Promise<void> {
    await tx.queueItem.updateMany({ where: { id: itemId, userId }, data: { topicId } });
  }
}
