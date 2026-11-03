import { Injectable } from '@nestjs/common';
import type { QueueItem, QueueResponse } from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { GenerationLimitsService, remaining } from './generation-limits.service';
import { MAX_GENERATIONS_PER_WINDOW, QUEUE_AUDIO_URL_TTL_SECONDS } from './queue-policy';
import { readHeardTopicIds } from './heard';
import { isCollecting } from './suggestion-state';
import { readStoryStates } from './story-state';

// Reads one person's queue for the app (ARCHITECTURE.md section 6, step 6). Every query is
// scoped by `userId`, which the caller takes from the verified token.
//
// A plain read: no transaction, no lock. Two reads can show a queue that is a moment apart,
// which is harmless; nothing here writes.
@Injectable()
export class QueueReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: GenerationLimitsService,
    private readonly storage: StorageService,
  ) {}

  async read(userId: string): Promise<QueueResponse> {
    const preferences = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { voiceId: true },
    });
    if (preferences === null) {
      // Onboarding is not finished: no voice, so no queue and nothing spent.
      return {
        items: [],
        generations: { left: MAX_GENERATIONS_PER_WINDOW, limit: MAX_GENERATIONS_PER_WINDOW },
        collecting: false,
      };
    }

    const rows = await this.prisma.queueItem.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, topicId: true, topic: { select: { title: true, style: true } } },
    });

    const topicIds = rows.map((row) => row.topicId);
    const states = await readStoryStates(this.prisma, preferences.voiceId, topicIds);
    // One batched query: the items whose story the person has heard. A heard item stays in the
    // queue until they remove it; the app only marks it.
    const heardTopicIds = await readHeardTopicIds(this.prisma, userId, topicIds);

    // One storage call for all ready items, and none when nothing is ready. The URLs come
    // back in the order of the paths, so they are matched by index.
    const readyIndexes: number[] = [];
    const readyPaths: string[] = [];
    rows.forEach((row, index) => {
      const state = states.get(row.topicId);
      if (state?.state === 'ready' && state.storagePath !== null) {
        readyIndexes.push(index);
        readyPaths.push(state.storagePath);
      }
    });
    const urls =
      readyPaths.length === 0
        ? []
        : await this.storage.signMany(readyPaths, QUEUE_AUDIO_URL_TTL_SECONDS);
    if (urls.length !== readyPaths.length) {
      throw new Error('Signed URL count does not match');
    }
    const urlByIndex = new Map(readyIndexes.map((rowIndex, i) => [rowIndex, urls[i]] as const));

    const items = rows.map((row, index): QueueItem => {
      const common = {
        id: row.id,
        topicId: row.topicId,
        title: row.topic.title,
        style: row.topic.style,
        heard: heardTopicIds.has(row.topicId),
      };
      const state = states.get(row.topicId);
      const audioUrl = urlByIndex.get(index);
      if (
        state?.state === 'ready' &&
        state.storyId !== null &&
        state.durationSec !== null &&
        audioUrl !== undefined
      ) {
        return {
          ...common,
          state: 'ready',
          storyId: state.storyId,
          durationSec: state.durationSec,
          audioUrl,
        };
      }
      // A topic without a state row cannot happen; it is shown as not ready, never as ready.
      const notReady = state === undefined || state.state === 'ready' ? 'not_ready' : state.state;
      return { ...common, state: notReady };
    });

    // For display only. The limit is enforced when a generation starts, under the lock on
    // the person's `users` row (the explicit-start cycle); this unlocked count can be stale.
    const { generationsLeft } = remaining(await this.limits.usage(this.prisma, userId));
    // "Collecting" only means something for an empty queue: a person with items has something
    // to show, whatever a suggestion job is doing.
    const collecting = items.length === 0 && (await isCollecting(this.prisma, userId));
    return {
      items,
      generations: { left: generationsLeft, limit: MAX_GENERATIONS_PER_WINDOW },
      collecting,
    };
  }
}
