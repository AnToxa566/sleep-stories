import { Injectable } from '@nestjs/common';
import { LISTEN_MIN_SEC } from '@sleep-stories/contracts';
import type { ListenReportRequest, ListenReportResponse } from '@sleep-stories/contracts';
import { lockUserRow } from '../prisma/lock-user-row';
import { PrismaService } from '../prisma/prisma.service';
import { storyUnavailable } from './story-unavailable';

// A player can report a position a little past the end (rounding, a final tick). Anything
// beyond the audio duration plus this slack is not a real listen, so it is cut to the bound.
export const LISTEN_DURATION_SLACK_SEC = 5;

// Records that a person left a story (finished or skipped; the outcome is derived from
// `listened_sec` and the audio duration and is never stored, AGENTS.md architecture rule 4).
// It creates no generation job and spends no generation.
@Injectable()
export class ListensService {
  constructor(private readonly prisma: PrismaService) {}

  async report(userId: string, request: ListenReportRequest): Promise<ListenReportResponse> {
    // The voice is the person's own preference, never a value from the request.
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { voiceId: true },
    });
    if (preference === null) {
      throw storyUnavailable();
    }
    const audio = await this.prisma.storyAudio.findUnique({
      where: { storyId_voiceId: { storyId: request.storyId, voiceId: preference.voiceId } },
      select: { durationSec: true, story: { select: { topicId: true } } },
    });
    if (audio === null) {
      throw storyUnavailable();
    }

    const listenedSec = Math.min(request.listenedSec, audio.durationSec + LISTEN_DURATION_SLACK_SEC);
    if (listenedSec < LISTEN_MIN_SEC) {
      return { recorded: false };
    }

    await this.prisma.$transaction(async (tx) => {
      // The same lock as every queue edit of this person, so removing the item and closing
      // the gap never interleave with a top-up, an edit or a start.
      if (!(await lockUserRow(tx, userId))) {
        throw storyUnavailable();
      }
      await tx.listen.create({
        data: {
          userId,
          storyId: request.storyId,
          voiceId: preference.voiceId,
          listenedSec,
          listenedAt: new Date(),
        },
      });
      const removed = await tx.queueItem.deleteMany({
        where: { userId, topicId: audio.story.topicId },
      });
      if (removed.count > 0) {
        // The same gap closing as QueueEditService.remove.
        await tx.$executeRaw`
          UPDATE queue_items q SET position = r.rn::int
          FROM (
            SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rn
            FROM queue_items
            WHERE user_id = ${userId}::uuid
          ) r
          WHERE q.id = r.id AND q.user_id = ${userId}::uuid
        `;
      }
    });
    return { recorded: true };
  }
}
