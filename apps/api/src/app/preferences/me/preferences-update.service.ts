import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { ChangeVoiceRequest, MeResponse } from '@sleep-stories/contracts';
import { apiErrorBody } from '../../platform/errors/api-error-body';
import { lockUserRow } from '../../platform/prisma/lock-user-row/lock-user-row';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { MeService } from './me.service';

// Changes to the preferences of a person who has finished onboarding (ARCHITECTURE.md
// section 6, "Changing the narrator"). It creates no job and does not run the queue top-up,
// so it can never cost money (AGENTS.md architecture rule 10); no queue, top-up or jobs
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
}
