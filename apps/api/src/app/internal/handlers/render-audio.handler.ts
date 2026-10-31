import { Injectable } from '@nestjs/common';
import { AudioRendererService } from '../../generation/audio-renderer.service';
import { GenerationError } from '../../generation/generation-error';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobHandler } from '../job-handler';

// render_audio: one story in one voice, one TTS request, one file. The provider call and the
// upload run outside any transaction; the storage path is deterministic, so a retry
// overwrites the same object. One transaction then stores the story_audio row and marks the
// job succeeded, last (a stale run rolls back with its row). Known and accepted: a stale run
// whose lease was taken over can still overwrite the object after the winner committed, and
// TTS output is not byte-stable, so the surviving row's duration_sec and byte_size may
// describe the winner's file rather than the stored object (rare and bounded; listen
// outcomes use duration_sec; ARCHITECTURE.md section 11, item 18). Errors propagate untouched
// and nothing is logged.
@Injectable()
export class RenderAudioHandler implements JobHandler<'render_audio'> {
  readonly kind = 'render_audio' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: AudioRendererService,
  ) {}

  async run(ctx: JobContext<'render_audio'>): Promise<void> {
    const { storyId, voiceId } = ctx.job.payload;

    const [story, voice, existing] = await Promise.all([
      this.prisma.story.findUnique({ where: { id: storyId }, select: { text: true } }),
      this.prisma.voice.findUnique({ where: { id: voiceId }, select: { providerVoiceId: true } }),
      this.prisma.storyAudio.findUnique({
        where: { storyId_voiceId: { storyId, voiceId } },
        select: { id: true },
      }),
    ]);
    if (story === null || voice === null) {
      throw new GenerationError('job_target_missing', false);
    }

    // Already rendered (another delivery, or an earlier job): no TTS, no upload.
    if (existing !== null) {
      await this.prisma.$transaction(async (tx) => {
        await ctx.markSucceeded(tx);
      });
      return;
    }

    const rendered = await this.renderer.render({
      storyId,
      voice: { id: voiceId, providerVoiceId: voice.providerVoiceId },
      text: story.text,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.storyAudio.createMany({
        data: [
          {
            storyId,
            voiceId,
            storagePath: rendered.storagePath,
            durationSec: rendered.durationSec,
            byteSize: rendered.byteSize,
            mimeType: rendered.mimeType,
            ttsProvider: rendered.ttsProvider,
          },
        ],
        skipDuplicates: true,
      });
      await ctx.markSucceeded(tx);
    });
  }
}
