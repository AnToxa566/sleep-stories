import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type {
  ChangeInterestsRequest,
  ChangeVoiceRequest,
  MeResponse,
} from '@sleep-stories/contracts';
import { apiErrorBody } from '../../../platform/errors/api-error-body';
import { lockUserRow } from '../../../platform/prisma/lock-user-row/lock-user-row';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { MeService } from '../me.service';

// Changes to the preferences of a person who has finished onboarding (ARCHITECTURE.md
// section 6, "Changing the narrator" and "Changing the interests"). It creates no job and does
// not run the queue top-up, so it can never cost money (AGENTS.md architecture rule 10); no queue, top-up or jobs
// service is injected here on purpose.
@Injectable()
export class PreferencesUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly me: MeService,
  ) {}

  // Changes the narrator and nothing else. `userId` comes from the verified token only.
  // 422 for an unknown or inactive voice; 400 before onboarding is finished. A preferences
  // row is never created here: that row is the "onboarding is done" flag (GET /me).
  //
  // The users-row lock comes first. It orders the change against the explicit start, which
  // reads the voice under the same lock, and against the onboarding PUT. A job that already
  // exists is not touched: it carries its own voice and may finish in the old one (accepted
  // by the owner on 2026-11-27).
  async changeVoice(userId: string, request: ChangeVoiceRequest): Promise<MeResponse> {
    await this.prisma.$transaction(async (tx) => {
      const userExists = await lockUserRow(tx, userId);

      const voice = await tx.voice.findFirst({
        where: { slug: request.voiceSlug, isActive: true },
        select: { id: true },
      });
      if (voice === null) {
        throw new UnprocessableEntityException(apiErrorBody(422, 'unknown_voice', 'Unknown voice'));
      }

      // updateMany, not update or upsert: a missing row is a count of 0, not an exception
      // and not a new row.
      const updated = userExists
        ? await tx.userPreference.updateMany({ where: { userId }, data: { voiceId: voice.id } })
        : { count: 0 };
      if (updated.count === 0) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'Onboarding is not finished'),
        );
      }
    });

    // After the commit, so the answer is read the same way as GET /me.
    return this.me.getMe(userId);
  }

  // Replaces both interest lists and nothing else: no job, no top-up, no queue edit, even for
  // a new interest (owner, 2026-11-27). `userId` comes from the verified token only. 422 for
  // an unknown or inactive slug, or a NEW typed title that repeats a catalogue title; 400
  // before onboarding is finished. A refusal writes nothing.
  //
  // Only the difference is written. Unlike onboarding, a typed interest that stays keeps its
  // row: a waiting suggest_topics job names rows by id, and its handler silently drops an id
  // it cannot find.
  //
  // Typed titles are untrusted user text: never logged, never put in an error.
  async changeInterests(userId: string, request: ChangeInterestsRequest): Promise<MeResponse> {
    await this.prisma.$transaction(async (tx) => {
      const userExists = await lockUserRow(tx, userId);

      const interests = await tx.interest.findMany({
        where: { slug: { in: request.interestSlugs }, isActive: true },
        select: { id: true },
      });
      // The request schema guarantees the slugs are unique, so a shortfall means at least
      // one is unknown or inactive.
      if (interests.length !== request.interestSlugs.length) {
        throw new UnprocessableEntityException(apiErrorBody(422, 'unknown_interest', 'Unknown interest'));
      }
      const interestIds = interests.map((interest) => interest.id);

      // The preferences row is the "onboarding is done" flag (GET /me). It is only read.
      const preference = userExists
        ? await tx.userPreference.findUnique({ where: { userId }, select: { userId: true } })
        : null;
      if (preference === null) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'Onboarding is not finished'),
        );
      }

      // Stored titles and requested ones went through the same schema (trimmed, NFC,
      // lowercased), so they are compared as they are.
      const stored = await tx.userCustomInterest.findMany({
        where: { userId },
        select: { title: true },
      });
      const storedTitles = new Set(stored.map((row) => row.title));
      const newTitles = request.customInterests.filter((title) => !storedTitles.has(title));

      // The rule and the comparison of onboarding, but for new titles only: a title the
      // person already has must not block saving because the catalogue gained it later.
      if (newTitles.length > 0) {
        const catalogue = await tx.interest.findMany({ where: { isActive: true }, select: { title: true } });
        const catalogueTitles = new Set(catalogue.map((row) => row.title.toLowerCase()));
        if (newTitles.some((title) => catalogueTitles.has(title.toLowerCase()))) {
          throw new UnprocessableEntityException(
            apiErrorBody(422, 'validation_failed', 'A custom interest repeats a catalogue interest'),
          );
        }
      }

      // With an empty list, Prisma's `notIn: []` matches every row of this person.
      await tx.userInterest.deleteMany({ where: { userId, interestId: { notIn: interestIds } } });
      await tx.userInterest.createMany({
        data: interestIds.map((interestId) => ({ userId, interestId })),
        skipDuplicates: true,
      });

      await tx.userCustomInterest.deleteMany({
        where: { userId, title: { notIn: request.customInterests } },
      });
      if (newTitles.length > 0) {
        // As in onboarding: one millisecond per row keeps the request order of the new
        // titles. Kept rows are older, so GET /me lists them first, in their old order.
        const base = Date.now();
        await tx.userCustomInterest.createMany({
          data: newTitles.map((title, index) => ({ userId, title, createdAt: new Date(base + index) })),
        });
      }
    });

    return this.me.getMe(userId);
  }
}
