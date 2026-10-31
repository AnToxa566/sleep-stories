import { Injectable } from '@nestjs/common';
import {
  TopicsResponseSchema,
  type TopicsQuery,
  type TopicsResponse,
} from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { findReady, findWithoutAudio, findWithoutStory } from './queue-candidates';
import { readStoryStates } from './story-state';
import { buildTopicRows, TOPICS_LIST_MAX, type TopicInfo } from './topic-rows';

// The «Темы» list: the topics this person could be offered, with their state in the person's
// voice and whether the queue holds them. It uses the same three finders as the top-up, so the
// privacy rules (nobody's typed topic, the NULL-interest rule, the person's styles and
// interests, heard, dismissed, rated -1) are the one set in `queue-candidates.ts`, not a copy.
// It differs from the top-up only by what it lets through: topics already queued and topics
// that finally failed are included here (the failed ones are hidden unless queued, below).
//
// A plain read: no transaction, no lock, no `generation_jobs` write. Every query is scoped by
// `userId`, which the caller takes from the verified token. It never creates a job and never
// changes a row (AGENTS.md architecture rule 10).
@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  // `ready` true: only topics that can be played at once. false: only those that cannot (the
  // query schema accepts both words, so both need a meaning). Unset: all.
  async list(userId: string, query: TopicsQuery): Promise<TopicsResponse> {
    const preferences = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { voiceId: true },
    });
    if (preferences === null) {
      return TopicsResponseSchema.parse({ topics: [] });
    }
    const { voiceId } = preferences;
    const readyOnly = query.ready === undefined ? undefined : query.ready === 'true';

    const finder = {
      userId,
      voiceId,
      limit: TOPICS_LIST_MAX,
      style: query.style,
      includeQueued: true,
      includeFailed: true,
      includeOwn: true,
      order: 'newest' as const,
    };
    const ids: string[] = [];
    if (readyOnly !== false) {
      ids.push(...(await findReady(this.prisma, finder)).map((row) => row.topicId));
    }
    if (readyOnly !== true) {
      ids.push(...(await findWithoutAudio(this.prisma, finder)).map((row) => row.topicId));
      ids.push(...(await findWithoutStory(this.prisma, finder)));
    }
    if (ids.length === 0) {
      return TopicsResponseSchema.parse({ topics: [] });
    }

    const [topicRows, states, queueRows] = await Promise.all([
      this.prisma.topic.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, style: true, createdAt: true },
      }),
      readStoryStates(this.prisma, voiceId, ids),
      this.prisma.queueItem.findMany({
        where: { userId, topicId: { in: ids } },
        select: { topicId: true },
      }),
    ]);
    const topics = new Map<string, TopicInfo>(
      topicRows.map((row) => [row.id, { title: row.title, style: row.style, createdAt: row.createdAt }]),
    );
    const rows = buildTopicRows({
      ids,
      topics,
      states,
      queued: new Set(queueRows.map((row) => row.topicId)),
      readyOnly,
    });
    return TopicsResponseSchema.parse({ topics: rows });
  }
}
