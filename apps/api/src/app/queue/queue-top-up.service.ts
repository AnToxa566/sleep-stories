import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService, type GenerationJobSpec } from './generation-jobs.service';
import { GenerationLimitsService, remaining } from './generation-limits.service';
import { findReady, findRendering, findStalled, findWriting } from './queue-candidates';
import { QUEUE_TARGET_LENGTH, QUEUE_TOP_UP_THRESHOLD } from './queue-policy';
import { planTopUp } from './top-up-plan';

export type TopUpResult =
  | { skipped: 'no_preferences' }
  | {
      skipped: 'queue_full';
      // Stalled queue items that got a render job in this run (see run()).
      healed: number;
    }
  | {
      skipped?: undefined;
      queued: { ready: number; rendering: number; writing: number };
      suggestRequested: boolean;
      // True when the queue could not be filled to the target because a render or
      // suggestion slot ran out. Exact: the planner asks for a suggestion for everything
      // the three lists do not cover whenever a suggestion slot and a render slot remain,
      // and one suggestion covers at most the whole need (3), so anything still missing
      // after the plan can only be a limit.
      limitReached: boolean;
      queueLength: number;
      healed: number;
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
  // items or fewer: ready stories of the pool first (free), then stories that only lack
  // audio in the person's voice, then the person's own proposed topics, and only then asks
  // for new suggestions (ARCHITECTURE.md section 6, owner 2026-10-30).
  //
  // `userId` is a parameter supplied by the caller from a verified token or from a job row,
  // never from a body.
  //
  // One transaction, behind a row lock on the person's `users` row. The lock makes the limit
  // count and the inserts one step, so two simultaneous calls for one person cannot both see
  // a free slot or queue the same topic twice (the cost: the second call waits). The queue
  // is told about the new jobs only AFTER the commit; if that fails the rows stay `pending`
  // for the sweep of cycle 3b.
  //
  // Stalled items come first, before the queue_full return, so a full queue of them heals: a
  // queue item whose job insert once found an active job of another voice has a story but no
  // audio in this person's voice and no job coming. Each gets a render_audio job and uses one
  // render slot, taken off the slots before planning. If the insert finds an active job of the
  // same key (a race) no job is made and no slot is used; the planner's other slots are not
  // backfilled, the next run fixes it. Stalled "writing" items are not handled here.
  //
  // Every job of the run is inserted in the order of its dedupe key, so two transactions of
  // different people that want the same keys take the unique-index entries in the same order
  // and cannot deadlock on each other. Callers should still treat Postgres error 40P01 as
  // retryable (ARCHITECTURE.md section 6).
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

        const usage = remaining(await this.limits.usage(tx, userId));
        const stalled = await findStalled(tx, { userId, voiceId, limit: usage.rendersLeft });
        const rendersLeft = usage.rendersLeft - stalled.length;
        const healSpecs = stalled.map((row): GenerationJobSpec => ({
          userId,
          payload: { kind: 'render_audio', storyId: row.storyId, voiceId },
        }));

        const queueLength = await tx.queueItem.count({ where: { userId } });
        if (queueLength > QUEUE_TOP_UP_THRESHOLD) {
          const created = await this.jobs.createInKeyOrder(
            tx,
            userId,
            healSpecs.map((spec) => ({ spec, heal: true })),
          );
          return {
            result: { skipped: 'queue_full', healed: created.filter((c) => c.heal).length },
            createdJobIds: created.map((c) => c.id),
          };
        }

        const need = QUEUE_TARGET_LENGTH - queueLength;
        const query = { userId, voiceId, limit: need };
        const ready = await findReady(tx, query);
        const rendering = await findRendering(tx, query);
        const writing = await findWriting(tx, query);

        const storyByTopic = new Map(rendering.map((row) => [row.topicId, row.storyId]));
        const plan = planTopUp({
          queueLength,
          rendersLeft,
          suggestionsLeft: usage.suggestionsLeft,
          ready: ready.map((row) => row.topicId),
          rendering: rendering.map((row) => row.topicId),
          writing,
        });

        const topicIds = [...plan.queueReady, ...plan.queueRendering, ...plan.queueWriting];
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

        const planned: { spec: GenerationJobSpec; heal?: boolean; suggest?: boolean }[] = [
          ...healSpecs.map((spec) => ({ spec, heal: true })),
        ];
        for (const topicId of plan.queueRendering) {
          const storyId = storyByTopic.get(topicId);
          if (storyId !== undefined) {
            planned.push({ spec: { userId, payload: { kind: 'render_audio', storyId, voiceId } } });
          }
        }
        for (const topicId of plan.queueWriting) {
          planned.push({ spec: { userId, payload: { kind: 'write_story', topicId, voiceId } } });
        }
        if (plan.suggestMissing >= 1) {
          planned.push({
            spec: { userId, payload: { kind: 'suggest_topics', missing: plan.suggestMissing } },
            suggest: true,
          });
        }
        const created = await this.jobs.createInKeyOrder(tx, userId, planned);

        return {
          result: {
            queued: {
              ready: plan.queueReady.length,
              rendering: plan.queueRendering.length,
              writing: plan.queueWriting.length,
            },
            suggestRequested: created.some((c) => c.suggest),
            limitReached: topicIds.length + plan.suggestMissing < need,
            queueLength: queueLength + topicIds.length,
            healed: created.filter((c) => c.heal).length,
          },
          createdJobIds: created.map((c) => c.id),
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
