import { Injectable } from '@nestjs/common';
import { LISTEN_MIN_SEC } from '@sleep-stories/contracts';
import type { ListenReportRequest, ListenReportResponse } from '@sleep-stories/contracts';
import { lockUserRow } from '../../platform/prisma/lock-user-row/lock-user-row';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { storyUnavailable } from '../story-unavailable/story-unavailable';

// A player can report a position a little past the end (rounding, a final tick). Anything
// beyond the audio duration plus this slack is not a real listen, so it is cut to the bound.
export const LISTEN_DURATION_SLACK_SEC = 5;

// The writes of a person's listening history: a report adds a row, `markUnheard` removes the
// rows of one topic.
//
// A report records that a person left a story (finished or skipped; the outcome is derived from
// `listened_sec` and the audio duration and is never stored, AGENTS.md architecture rule 4).
// It only inserts the `listens` row: the queue changes by the person's own actions only, so a
// heard story stays in the queue until they remove it. Neither method creates a generation job
// or spends a generation.
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
      select: { durationSec: true },
    });
    if (audio === null) {
      throw storyUnavailable();
    }

    const listenedSec = Math.min(request.listenedSec, audio.durationSec + LISTEN_DURATION_SLACK_SEC);
    if (listenedSec < LISTEN_MIN_SEC) {
      return { recorded: false };
    }

    await this.prisma.$transaction(async (tx) => {
      // The same lock as every write of this person's data. It also turns a vanished `users`
      // row into the 404 below instead of a foreign-key error.
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
    });
    return { recorded: true };
  }

  // Makes the topic's story unheard for this person. Heard is derived from `listens`
  // (`../heard/heard.ts`), so ALL of the person's rows for the story are deleted, in every
  // voice, partial ones included. Cost: that part of the listening history is lost for good,
  // accepted for a change with no migration and no new rule for the readers of `listens`
  // (owner, 2026-11-26; ARCHITECTURE.md section 5). `userId` in the WHERE clause is what
  // keeps other people's rows safe. The queue and the jobs are not touched. A listen report
  // that arrives after this makes the story heard again.
  async markUnheard(userId: string, topicId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      await tx.listen.deleteMany({ where: { userId, story: { topicId } } });
    });
  }
}
