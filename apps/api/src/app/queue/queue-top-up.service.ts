import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService, remaining } from './generation-limits.service';
import { findReady, findWithoutAudio, findWithoutStory } from './queue-candidates';
import { QUEUE_TARGET_LENGTH, QUEUE_TOP_UP_THRESHOLD } from './queue-policy';
import { planTopUp } from './top-up-plan';

export type TopUpResult =
  | { skipped: 'no_preferences' }
  | { skipped: 'queue_full' }
  | {
      skipped?: undefined;
      queued: { ready: number; withoutAudio: number; withoutStory: number };
      suggestRequested: boolean;
      queueLength: number;
    };

type Outcome = { result: TopUpResult; createdJobIds: string[] };

const UserRowsSchema = z.array(z.object({ id: z.uuid() }));

@Injectable()
export class QueueTopUpService {
  private readonly logger = new Logger(QueueTopUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: GenerationLimitsService,
    private readonly jobs: GenerationJobsService,
    private readonly jobQueue: JobQueue,
  ) {}

  // Fills the person's queue up to QUEUE_TARGET_LENGTH when it holds QUEUE_TOP_UP_THRESHOLD
  // items or fewer: ready stories of the pool first, then stories that lack audio in the
  // person's voice, then the person's own proposed topics with no story, and only then asks
  // for new suggestions (ARCHITECTURE.md section 6, "Queue top-up", owner 2026-10-31).
  //
  // This creates NO `write_story` and NO `render_audio` job: nothing that costs a generation
  // starts on its own (AGENTS.md architecture rule 10). The only job it may create is
  // `suggest_topics`, which needs one suggestion slot and no generation slot.
  //
  // `userId` is a parameter supplied by the caller from a verified token or from a job row,
  // never from a body.
  //
  // One transaction, behind a row lock on the person's `users` row. The lock makes the limit
  // count and the inserts one step, so two simultaneous calls for one person cannot both see
  // a free slot or queue the same topic twice (the cost: the second call waits). The queue
  // is told about the new job only AFTER the commit; if that fails the row stays `pending`
  // for the sweep.
  async run(userId: string): Promise<TopUpResult> {
    const { result, createdJobIds } = await this.prisma.$transaction(
      async (tx): Promise<Outcome> => {
        const locked = UserRowsSchema.parse(
          await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
        );
        if (locked.length === 0) {
          return { result: { skipped: 'no_preferences' }, createdJobIds: [] };
        }

        const preferences = await tx.userPreference.findUnique({
          where: { userId },
          select: { voiceId: true },
        });
        if (preferences === null) {
          return { result: { skipped: 'no_preferences' }, createdJobIds: [] };
        }
        const voiceId = preferences.voiceId;

        const queueLength = await tx.queueItem.count({ where: { userId } });
        if (queueLength > QUEUE_TOP_UP_THRESHOLD) {
          return { result: { skipped: 'queue_full' }, createdJobIds: [] };
        }

        const need = QUEUE_TARGET_LENGTH - queueLength;
        const query = { userId, voiceId, limit: need };
        const ready = await findReady(tx, query);
        const withoutAudio = await findWithoutAudio(tx, query);
        const withoutStory = await findWithoutStory(tx, query);

        const usage = remaining(await this.limits.usage(tx, userId));
        const plan = planTopUp({
          queueLength,
          suggestionsLeft: usage.suggestionsLeft,
          ready: ready.map((row) => row.topicId),
          withoutAudio: withoutAudio.map((row) => row.topicId),
          withoutStory,
        });

        const topicIds = [...plan.queueReady, ...plan.queueWithoutAudio, ...plan.queueWithoutStory];
        if (topicIds.length > 0) {
          const last = await tx.queueItem.aggregate({ where: { userId }, _max: { position: true } });
          const firstPosition = (last._max.position ?? 0) + 1;
          // skipDuplicates cannot hide a duplicate here: the row lock serialises runs of this
          // person and the candidate queries exclude topics already in the queue, so every row
          // is new and the counts above stay exact.
          await tx.queueItem.createMany({
            data: topicIds.map((topicId, index) => ({
              userId,
              topicId,
              position: firstPosition + index,
            })),
            skipDuplicates: true,
          });
        }

        // The only job a top-up may create.
        const created =
          plan.suggestMissing >= 1
            ? await this.jobs.create(tx, {
                userId,
                payload: { kind: 'suggest_topics', missing: plan.suggestMissing },
              })
            : null;

        return {
          result: {
            queued: {
              ready: plan.queueReady.length,
              withoutAudio: plan.queueWithoutAudio.length,
              withoutStory: plan.queueWithoutStory.length,
            },
            suggestRequested: created !== null,
            queueLength: queueLength + topicIds.length,
          },
          createdJobIds: created === null ? [] : [created],
        };
      },
    );

    // After the commit. One failing enqueue neither throws nor stops the others; the row
    // stays `pending`. The log line is fixed: no ids, no error text.
    for (const jobId of createdJobIds) {
      try {
        await this.jobQueue.enqueue(jobId);
      } catch {
        this.logger.warn('Enqueueing a generation job failed; it stays pending');
      }
    }
    return result;
  }
}
