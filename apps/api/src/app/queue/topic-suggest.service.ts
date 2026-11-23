import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { SuggestTopicsRequest, SuggestionStatusResponse } from '@sleep-stories/contracts';
import { apiErrorBody } from '../errors/api-error-body';
import { lockUserRow } from '../prisma/lock-user-row';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService, remaining } from './generation-limits.service';
import { MAX_SUGGESTIONS_PER_WINDOW } from './queue-policy';
import { readLatestSuggestion, readNextSuggestionAt } from './suggestion-state';

// «Подобрать темы» on «Темы» (ARCHITECTURE.md section 6, "Topics on request"; owner,
// 2026-11-22). It starts one `suggest_topics` job narrowed to the interests and styles the
// person ticked in the sheet. The new topics only join the person's list («Темы»); nothing is
// queued (`missing: 0`) and no story or audio job is created (AGENTS.md architecture rule 10).
//
// The cap is the one the queue top-up uses: 5 suggestions per rolling 24 hours, shared (owner,
// 2026-11-22). Counting and inserting happen in one transaction behind the person's users-row
// lock, like the top-up, so two taps cannot both see a free slot. The job is enqueued only
// after the commit; if that fails the row stays `pending` for the sweep.
//
// `userId` comes from the verified token only. The body names values, never a person, and
// every value must be one of the person's own settings: a slug or a typed interest the person
// does not have is refused, so a request cannot reach another person's typed text.
@Injectable()
export class TopicSuggestService {
  private readonly logger = new Logger(TopicSuggestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: GenerationLimitsService,
    private readonly jobs: GenerationJobsService,
    private readonly jobQueue: JobQueue,
  ) {}

  // 400 for a value outside the person's settings (or no onboarding), 409 while a suggestion
  // is already in progress, 429 when the cap is used up. Nothing is written in those cases.
  async start(userId: string, body: SuggestTopicsRequest): Promise<SuggestionStatusResponse> {
    const jobId = await this.prisma.$transaction(async (tx): Promise<string> => {
      // A token with no `users` row locks nothing, but such a person has no preferences either
      // (foreign key), so the check below answers 400 before any insert.
      await lockUserRow(tx, userId);

      const preferences = await tx.userPreference.findUnique({
        where: { userId },
        select: { styles: true },
      });
      if (preferences === null) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'Onboarding is not finished'),
        );
      }
      if (!body.styles.every((style) => preferences.styles.includes(style))) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'A style is not among the chosen ones'),
        );
      }

      const interests = await tx.userInterest.findMany({
        where: { userId, interest: { slug: { in: body.interestSlugs }, isActive: true } },
        select: { interestId: true },
      });
      // Typed interests are stored normalised by the same schema the body was parsed with,
      // so an exact match is the right comparison.
      const custom = await tx.userCustomInterest.findMany({
        where: { userId, title: { in: body.customInterests } },
        select: { id: true },
      });
      // The schemas refuse repeated values, so a shorter result means an unknown one.
      if (
        interests.length !== body.interestSlugs.length ||
        custom.length !== body.customInterests.length
      ) {
        throw new BadRequestException(
          apiErrorBody(400, 'unknown_interest', 'An interest is not among the chosen ones'),
        );
      }

      // Before the cap: an active suggestion also holds a slot, and "in progress" is the
      // truer answer then.
      if ((await readLatestSuggestion(tx, userId))?.state === 'running') {
        throw suggestionInProgress();
      }
      const { suggestionsLeft } = remaining(await this.limits.usage(tx, userId));
      if (suggestionsLeft < 1) {
        throw new HttpException(
          apiErrorBody(429, 'suggestion_limit_reached', 'Suggestion limit reached'),
          429,
        );
      }

      const created = await this.jobs.create(tx, {
        userId,
        payload: {
          kind: 'suggest_topics',
          missing: 0,
          selection: {
            styles: body.styles,
            interestIds: interests.map((row) => row.interestId),
            customInterestIds: custom.map((row) => row.id),
          },
        },
      });
      // The lock serialises this person's suggestions, so the check above already saw any
      // active job; this only guards the dedupe index's own answer.
      if (created === null) {
        throw suggestionInProgress();
      }
      return created;
    });

    // After the commit. The log line is fixed: no ids, no error text.
    try {
      await this.jobQueue.enqueue(jobId);
    } catch {
      this.logger.warn('Enqueueing a generation job failed; it stays pending');
    }
    return this.status(userId);
  }

  // The state behind the sheet and its three buttons. A plain read outside any lock.
  async status(userId: string): Promise<SuggestionStatusResponse> {
    const latest = await readLatestSuggestion(this.prisma, userId);
    const { suggestionsLeft } = remaining(await this.limits.usage(this.prisma, userId));
    const nextAt = suggestionsLeft === 0 ? await readNextSuggestionAt(this.prisma, userId) : null;
    return {
      latest,
      suggestions: {
        left: suggestionsLeft,
        limit: MAX_SUGGESTIONS_PER_WINDOW,
        nextAt: nextAt === null ? null : nextAt.toISOString(),
      },
    };
  }
}

function suggestionInProgress(): ConflictException {
  return new ConflictException(
    apiErrorBody(409, 'suggestion_in_progress', 'A topic suggestion is already in progress'),
  );
}
