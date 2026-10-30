import { randomUUID } from 'node:crypto';
import type { JobKind } from '@sleep-stories/contracts';
import type { PrismaService } from '../app/prisma/prisma.service';
import type { JobStatus, StoryStyle, TopicReason } from '../generated/prisma/client';

// Builds rows for the queue integration tests and removes them afterwards. Every row uses
// random slugs and ids, so a test never depends on (or disturbs) seeded or leftover data,
// and everything created here is tracked for cleanup().
export class QueueTestData {
  private readonly userIds: string[] = [];
  private readonly jobIds: string[] = [];
  private readonly storyIds: string[] = [];
  private readonly topicIds: string[] = [];
  private readonly voiceIds: string[] = [];
  private readonly interestIds: string[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async voice(): Promise<string> {
    const slug = `qt-${randomUUID()}`;
    const row = await this.prisma.voice.create({
      data: {
        slug,
        name: 'Test voice',
        description: 'Test voice',
        ttsProvider: 'test',
        providerVoiceId: slug,
        sampleAudioPath: `voices/${slug}/sample.mp3`,
      },
      select: { id: true },
    });
    this.voiceIds.push(row.id);
    return row.id;
  }

  async interest(): Promise<string> {
    const slug = `qt-${randomUUID()}`;
    const row = await this.prisma.interest.create({
      data: { slug, title: slug },
      select: { id: true },
    });
    this.interestIds.push(row.id);
    return row.id;
  }

  // A person. With `voiceId` they also get preferences (onboarding done); `interestIds`
  // are their chosen catalogue interests.
  async user(
    options: { voiceId?: string; styles?: StoryStyle[]; interestIds?: string[] } = {},
  ): Promise<string> {
    const id = randomUUID();
    this.userIds.push(id);
    await this.prisma.user.create({ data: { id } });
    if (options.voiceId !== undefined) {
      await this.prisma.userPreference.create({
        data: { userId: id, voiceId: options.voiceId, styles: options.styles ?? ['facts'] },
      });
    }
    if (options.interestIds !== undefined && options.interestIds.length > 0) {
      await this.prisma.userInterest.createMany({
        data: options.interestIds.map((interestId) => ({ userId: id, interestId })),
      });
    }
    return id;
  }

  // A topic, optionally with a story and with audio in the given voices.
  async topic(
    options: {
      style?: StoryStyle;
      interestId?: string | null;
      story?: boolean;
      audioVoiceIds?: string[];
    } = {},
  ): Promise<{ topicId: string; storyId: string | null }> {
    const topic = await this.prisma.topic.create({
      data: {
        title: `qt-${randomUUID()}`,
        style: options.style ?? 'facts',
        interestId: options.interestId ?? null,
      },
      select: { id: true },
    });
    this.topicIds.push(topic.id);
    const withAudio = options.audioVoiceIds ?? [];
    if (options.story !== true && withAudio.length === 0) {
      return { topicId: topic.id, storyId: null };
    }
    const story = await this.prisma.story.create({
      data: {
        topicId: topic.id,
        text: 'test story',
        charCount: 10,
        llmModel: 'test',
        promptVersion: 'test',
      },
      select: { id: true },
    });
    this.storyIds.push(story.id);
    for (const voiceId of withAudio) {
      await this.prisma.storyAudio.create({
        data: {
          storyId: story.id,
          voiceId,
          storagePath: `test/${randomUUID()}.mp3`,
          durationSec: 60,
          byteSize: 1000,
          mimeType: 'audio/mpeg',
          ttsProvider: 'test',
        },
      });
    }
    return { topicId: topic.id, storyId: story.id };
  }

  // Adds a story (and audio in the given voices) to an existing topic, as a finished
  // write_story job would.
  async storyFor(topicId: string, audioVoiceIds: string[] = []): Promise<string> {
    const story = await this.prisma.story.create({
      data: { topicId, text: 'test story', charCount: 10, llmModel: 'test', promptVersion: 'test' },
      select: { id: true },
    });
    this.storyIds.push(story.id);
    for (const voiceId of audioVoiceIds) {
      await this.prisma.storyAudio.create({
        data: {
          storyId: story.id,
          voiceId,
          storagePath: `test/${randomUUID()}.mp3`,
          durationSec: 60,
          byteSize: 1000,
          mimeType: 'audio/mpeg',
          ttsProvider: 'test',
        },
      });
    }
    return story.id;
  }

  async markJob(jobId: string, status: JobStatus): Promise<void> {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status, finishedAt: status === 'succeeded' ? new Date() : null },
    });
  }

  async queueItem(userId: string, topicId: string, position: number): Promise<void> {
    await this.prisma.queueItem.create({ data: { userId, topicId, position } });
  }

  async listen(userId: string, storyId: string, voiceId: string): Promise<void> {
    await this.prisma.listen.create({
      data: { userId, storyId, voiceId, listenedSec: 30, listenedAt: new Date() },
    });
  }

  async rating(userId: string, storyId: string, rating: -1 | 1): Promise<void> {
    await this.prisma.storyRating.create({ data: { userId, storyId, rating } });
  }

  async userTopic(
    userId: string,
    topicId: string,
    reason: TopicReason,
    options: { dismissed?: boolean } = {},
  ): Promise<void> {
    await this.prisma.userTopic.create({
      data: {
        userId,
        topicId,
        reason,
        dismissedAt: options.dismissed === true ? new Date() : null,
      },
    });
  }

  // A job row in any state. `hoursAgo` sets finished_at for finished jobs. The dedupe key
  // is random unless given, so rows never collide with the partial unique index.
  async job(options: {
    userId: string;
    kind: JobKind;
    status: JobStatus;
    hoursAgo?: number;
    dedupeKey?: string;
  }): Promise<string> {
    const finished = options.status === 'succeeded' || options.status === 'failed';
    const finishedAt = finished
      ? new Date(Date.now() - (options.hoursAgo ?? 1) * 3_600_000)
      : null;
    const row = await this.prisma.generationJob.create({
      data: {
        kind: options.kind,
        payload: { kind: options.kind },
        dedupeKey: options.dedupeKey ?? `test:${randomUUID()}`,
        requestedByUserId: options.userId,
        status: options.status,
        finishedAt,
      },
      select: { id: true },
    });
    this.jobIds.push(row.id);
    return row.id;
  }

  // Order respects the RESTRICT keys: jobs first (by requester, so jobs made by the code
  // under test are found before the SET NULL on user deletion hides them), then the users
  // (cascades queue items, user topics, listens, ratings, preferences, interests), then
  // audio, stories, topics, and last the test voices and interests.
  async cleanup(): Promise<void> {
    await this.prisma.generationJob.deleteMany({
      where: { OR: [{ requestedByUserId: { in: this.userIds } }, { id: { in: this.jobIds } }] },
    });
    await this.prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
    await this.prisma.storyAudio.deleteMany({ where: { storyId: { in: this.storyIds } } });
    await this.prisma.story.deleteMany({ where: { id: { in: this.storyIds } } });
    await this.prisma.topic.deleteMany({ where: { id: { in: this.topicIds } } });
    await this.prisma.voice.deleteMany({ where: { id: { in: this.voiceIds } } });
    await this.prisma.interest.deleteMany({ where: { id: { in: this.interestIds } } });
  }
}
