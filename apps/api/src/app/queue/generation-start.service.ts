import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { QueueResponse } from '@sleep-stories/contracts';
import { z } from 'zod';
import { apiErrorBody } from '../errors/api-error-body';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService, remaining } from './generation-limits.service';
import { planStart } from './generation-start-plan';
import { queueItemNotFound } from './queue-item-not-found';
import { QueueReadService } from './queue-read.service';
import { readStoryStates } from './story-state';

const UserRowsSchema = z.array(z.object({ id: z.uuid() }));

// The only place that creates `write_story` and `render_audio` jobs: an explicit start by the
// person, either the main button (every item that is `not_ready` or `failed`) or one item
// ("Создать сейчас", "Повторить"). ARCHITECTURE.md section 6, "Generation is explicit",
// rules 3 to 7. Nothing else may create them (AGENTS.md architecture rule 10).
//
// One transaction behind the lock on the person's `users` row, the same lock as the top-up
// and the queue edits. The lock makes "count what is left" and "insert the jobs" one step, so
// two taps cannot both see a free slot. The cost: a second request of the same person waits.
// The suggestion cap is never read here, only the generation count.
@Injectable()
export class GenerationStartService {
  private readonly logger = new Logger(GenerationStartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: GenerationLimitsService,
    private readonly jobs: GenerationJobsService,
    private readonly jobQueue: JobQueue,
    private readonly reader: QueueReadService,
  ) {}

  // `itemId` set: start that one item (404 if it is not the caller's). Unset: the main
  // button. All-or-nothing: fewer generations left than items to start gives 429 and writes
  // nothing. Nothing to start (everything ready or already being made) is a plain 200, also
  // at zero left. `userId` comes from the verified token only.
  async start(userId: string, itemId?: string): Promise<QueueResponse> {
    const createdJobIds = await this.prisma.$transaction(async (tx): Promise<string[]> => {
      // A token for a person with no `users` row locks nothing, but such a person has no
      // preferences either (foreign key), so the check below answers 400 before any insert.
      UserRowsSchema.parse(
        await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
      );

      let items: { id: string; topicId: string }[];
      if (itemId === undefined) {
        items = await tx.queueItem.findMany({
          where: { userId },
          select: { id: true, topicId: true },
        });
      } else {
        // The WHERE names both the item and the person: a missing id and a foreign id are
        // the same 404.
        const item = await tx.queueItem.findFirst({
          where: { id: itemId, userId },
          select: { id: true, topicId: true },
        });
        if (item === null) {
          throw queueItemNotFound();
        }
        items = [item];
      }

      const preferences = await tx.userPreference.findUnique({
        where: { userId },
        select: { voiceId: true },
      });
      if (preferences === null) {
        throw new BadRequestException(
          apiErrorBody(400, 'validation_failed', 'Onboarding is not finished'),
        );
      }
      const voiceId = preferences.voiceId;

      const states = await readStoryStates(tx, voiceId, items.map((row) => row.topicId));
      const { generationsLeft } = remaining(await this.limits.usage(tx, userId));
      const plan = planStart({
        items: items.map((row) => ({ itemId: row.id, topicId: row.topicId })),
        states,
        voiceId,
        generationsLeft,
      });

      if (plan.kind === 'refused') {
        // Before any insert: nothing was written, the throw only ends the transaction.
        throw new HttpException(
          apiErrorBody(429, 'generation_limit_reached', 'Generation limit reached'),
          429,
        );
      }
      if (plan.kind === 'noop') {
        return [];
      }

      // A job whose key already has an active job (for example another person is writing
      // the same topic) is omitted: this person joins it and uses no slot (ARCHITECTURE.md
      // section 6, "Generation is explicit", rule 7; open item 31).
      const created = await this.jobs.createInKeyOrder(
        tx,
        userId,
        plan.payloads.map((payload) => ({ spec: { userId, payload } })),
      );
      return created.map((job) => job.id);
    });

    // After the commit. One failing enqueue neither throws nor stops the others; the row
    // stays `pending` for the sweep. The log line is fixed: no ids, no error text.
    for (const jobId of createdJobIds) {
      try {
        await this.jobQueue.enqueue(jobId);
      } catch {
        this.logger.warn('Enqueueing a generation job failed; it stays pending');
      }
    }
    // Read after the commit and outside the lock, like the queue edits.
    return this.reader.read(userId);
  }
}
