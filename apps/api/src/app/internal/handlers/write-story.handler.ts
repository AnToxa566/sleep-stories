import { Injectable, Logger } from '@nestjs/common';
import { GenerationError } from '../../generation/generation-error';
import { StoryWriterService, type WriteStoryResult } from '../../generation/story-writer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobQueue } from '../../providers/job-queue/job-queue';
import { GenerationJobsService } from '../../queue/generation-jobs.service';
import type { JobContext, JobHandler } from '../job-handler';

// write_story: one topic, one story, then the render_audio job for the requester's voice
// (ARCHITECTURE.md section 6, "How jobs run", step 7).
// - The model call runs outside any transaction (it is slow and paid).
// - One transaction then stores the story, creates the render_audio job and marks this job
//   succeeded, last: a stale run (lease lost) rolls back with its rows, so a slot is never
//   counted twice or zero times.
// - The render job is handed to the queue only after the commit. If that fails the row
//   stays `pending` and the sweep picks it up.
// Errors propagate untouched: the runner classifies them. Nothing is logged except one fixed
// line when the hand-over fails (no ids, titles or text).
@Injectable()
export class WriteStoryHandler implements JobHandler<'write_story'> {
  readonly kind = 'write_story' as const;
  private readonly logger = new Logger(WriteStoryHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: StoryWriterService,
    private readonly jobs: GenerationJobsService,
    private readonly queue: JobQueue,
  ) {}

  async run(ctx: JobContext<'write_story'>): Promise<void> {
    const { topicId, voiceId } = ctx.job.payload;
    const requesterId = ctx.job.userId;

    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { style: true, title: true, story: { select: { id: true } } },
    });
    if (topic === null) {
      throw new GenerationError('job_target_missing', false);
    }

    // A story that already exists (another delivery, or an earlier job of this topic) is
    // reused: no second model call.
    const written: WriteStoryResult | null =
      topic.story === null
        ? await this.writer.write({ style: topic.style, topicTitle: topic.title })
        : null;

    const renderJobId = await this.prisma.$transaction(async (tx) => {
      if (written !== null) {
        // ON CONFLICT DO NOTHING on the unique topic_id: a concurrent run that stored the
        // story first wins, and this one reads its id back.
        await tx.story.createMany({
          data: [
            {
              topicId,
              text: written.text,
              charCount: written.text.length,
              llmModel: written.model,
              promptVersion: written.promptVersion,
            },
          ],
          skipDuplicates: true,
        });
      }
      const story = await tx.story.findUniqueOrThrow({
        where: { topicId },
        select: { id: true },
      });

      let created: string | null = null;
      if (requesterId !== null) {
        const audio = await tx.storyAudio.findUnique({
          where: { storyId_voiceId: { storyId: story.id, voiceId } },
          select: { id: true },
        });
        if (audio === null) {
          created = await this.jobs.create(tx, {
            userId: requesterId,
            payload: { kind: 'render_audio', storyId: story.id, voiceId },
          });
        }
      }

      await ctx.markSucceeded(tx);
      return created;
    });

    if (renderJobId !== null) {
      try {
        await this.queue.enqueue(renderJobId);
      } catch {
        this.logger.warn('Enqueueing a generation job failed; it stays pending');
      }
    }
  }
}
