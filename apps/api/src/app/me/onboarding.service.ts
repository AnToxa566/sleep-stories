import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { CompleteOnboardingRequest, MeResponse } from '@sleep-stories/contracts';
import { apiErrorBody } from '../errors/api-error-body';
import { PrismaService } from '../prisma/prisma.service';
import { QueueTopUpService } from '../queue/queue-top-up.service';
import { UsersService } from '../users/users.service';
import { inCanonicalOrder } from './story-styles';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly topUp: QueueTopUpService,
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
  // 4. replace the catalogue interest set;
  // 5. replace the user's custom interests (delete all of theirs, insert the
  //    request's). Before that, refuse with 422 a custom title that equals,
  //    ignoring case, the title of an active catalogue interest. The custom text
  //    is untrusted user input: it is never logged and never put in an error;
  // 6. upsert user_preferences LAST. That row is the "onboarding is done" flag
  //    (GET /me), so it must never exist without the interests. The transaction
  //    makes the order matter less, but the order keeps the invariant even if
  //    someone later splits the work up.
  //
  // After the transaction has committed, the queue top-up starts the person's first
  // stories. It runs on every successful call, not only the first, and an error in it is
  // swallowed with one fixed log line: onboarding must not fail because generation could not
  // start (a later top-up picks the person up).
  async complete(userId: string, request: CompleteOnboardingRequest): Promise<MeResponse> {
    const result = await this.prisma.$transaction(async (tx): Promise<MeResponse> => {
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

      const customTitles = request.customInterests;
      if (customTitles.length > 0) {
        // The customs are already trimmed and lowercased by the request schema.
        // Catalogue titles are lowercased here; both sides use the same JS rule.
        const catalogue = await tx.interest.findMany({ where: { isActive: true }, select: { title: true } });
        const catalogueTitles = new Set(catalogue.map((row) => row.title.toLowerCase()));
        if (customTitles.some((title) => catalogueTitles.has(title.toLowerCase()))) {
          // 'validation_failed' is the closest code in the contract today; a
          // dedicated code would need a change in packages/contracts.
          throw new UnprocessableEntityException(
            apiErrorBody(422, 'validation_failed', 'A custom interest repeats a catalogue interest'),
          );
        }
      }

      await tx.userInterest.deleteMany({ where: { userId, interestId: { notIn: interestIds } } });
      await tx.userInterest.createMany({
        data: interestIds.map((interestId) => ({ userId, interestId })),
        skipDuplicates: true,
      });

      await tx.userCustomInterest.deleteMany({ where: { userId } });
      if (customTitles.length > 0) {
        // One transaction gives every row the same now(), so the request order is
        // kept by giving each row its own millisecond (the column has ms precision).
        // GET /me reads them back ordered by created_at, then id.
        const base = Date.now();
        await tx.userCustomInterest.createMany({
          data: customTitles.map((title, index) => ({ userId, title, createdAt: new Date(base + index) })),
        });
      }

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
          customInterests: customTitles,
        },
      };
    });

    try {
      await this.topUp.run(userId);
    } catch {
      // Nothing from the error is logged: it may carry ids or provider text.
      this.logger.warn('Starting the queue top-up after onboarding failed');
    }
    return result;
  }
}
