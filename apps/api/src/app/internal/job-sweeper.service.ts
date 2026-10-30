import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import {
  JOB_LEASE_MINUTES,
  SWEEP_BATCH_SIZE,
  SWEEP_PENDING_AFTER_MINUTES,
} from '../queue/queue-policy';

const IdRowSchema = z.object({ id: z.uuid() });

// Finds jobs that nobody is working on and hands their ids back to the queue: a `pending`
// job older than SWEEP_PENDING_AFTER_MINUTES (its enqueue failed or its task was lost) and
// a `running` job past the lease (its run crashed). It never claims or changes a row: the
// claim in JobRunnerService decides whether the job runs, so a double enqueue is harmless.
// At most SWEEP_BATCH_SIZE per call, oldest first. A failed enqueue is counted out and
// logged nowhere (an id or a queue error could be sensitive); the next sweep finds the job
// again.
@Injectable()
export class JobSweeperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
  ) {}

  async sweep(): Promise<{ enqueued: number }> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT id
      FROM generation_jobs
      WHERE (
          status = 'pending'
          AND created_at < now() - make_interval(mins => ${SWEEP_PENDING_AFTER_MINUTES}::int)
        )
        OR (
          status = 'running'
          AND started_at < now() - make_interval(mins => ${JOB_LEASE_MINUTES}::int)
        )
      ORDER BY created_at ASC
      LIMIT ${SWEEP_BATCH_SIZE}::int
    `;
    let enqueued = 0;
    for (const row of z.array(IdRowSchema).parse(rows)) {
      try {
        await this.queue.enqueue(row.id);
        enqueued += 1;
      } catch {
        // Swallowed on purpose; see the class comment.
      }
    }
    return { enqueued };
  }
}
