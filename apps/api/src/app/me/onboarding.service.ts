import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { CompleteOnboardingRequest, MeResponse } from '@sleep-stories/contracts';
import { apiErrorBody } from '../errors/api-error-body';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { inCanonicalOrder } from './story-styles';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  // Saves the onboarding answers. Idempotent: the same request again leaves the
  // same state. `userId` comes from the verified token only.
  //
  // One transaction, in this order:
  // 1. create the users row if it is missing;
  // 2. lock the user's row, so two concurrent submits by the same user run one
  //    after the other instead of interleaving their delete and insert steps
  //    (cost: the second waits; the lock is per user, so other users are not held);
  // 3. resolve the voice and the interests to ACTIVE rows, and refuse with 422
  //    before any write if one is unknown or inactive;
  // 4. replace the interest set;
  // 5. upsert user_preferences LAST. That row is the "onboarding is done" flag
  //    (GET /me), so it must never exist without the interests. The transaction
  //    makes the order matter less, but the order keeps the invariant even if
  //    someone later splits the work up.
  async complete(userId: string, request: CompleteOnboardingRequest): Promise<MeResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.users.ensureExists(userId, tx);

      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

      const voice = await tx.voice.findFirst({
        where: { slug: request.voiceSlug, isActive: true },
        select: { id: true, slug: true },
      });
      if (voice === null) {
        throw new UnprocessableEntityException(apiErrorBody(422, 'unknown_voice', 'Unknown voice'));
      }

      const interests = await tx.interest.findMany({
        where: { slug: { in: request.interestSlugs }, isActive: true },
        select: { id: true, slug: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      });
      // The request schema guarantees the slugs are unique, so a shortfall means
      // at least one is unknown or inactive.
      if (interests.length !== request.interestSlugs.length) {
        throw new UnprocessableEntityException(apiErrorBody(422, 'unknown_interest', 'Unknown interest'));
      }
      const interestIds = interests.map((interest) => interest.id);

      await tx.userInterest.deleteMany({ where: { userId, interestId: { notIn: interestIds } } });
      await tx.userInterest.createMany({
        data: interestIds.map((interestId) => ({ userId, interestId })),
        skipDuplicates: true,
      });

      const styles = inCanonicalOrder(request.styles);
      await tx.userPreference.upsert({
        where: { userId },
        create: { userId, voiceId: voice.id, styles },
        update: { voiceId: voice.id, styles },
      });

      return {
        onboardingCompleted: true,
        preferences: {
          voiceSlug: voice.slug,
          styles,
          interestSlugs: interests.map((interest) => interest.slug),
        },
      };
    });
  }
}
