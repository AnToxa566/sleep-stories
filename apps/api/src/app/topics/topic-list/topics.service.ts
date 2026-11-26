import { Injectable } from '@nestjs/common';
import {
  TopicsResponseSchema,
  type TopicsQuery,
  type TopicsResponse,
} from '@sleep-stories/contracts';
import { lockUserRow } from '../../platform/prisma/lock-user-row/lock-user-row';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { readHeardTopicIds } from '../../listens/heard/heard';
import { findReady, findWithoutAudio, findWithoutStory } from '../candidates/topic-candidates';
import { readStoryStates } from '../../generation/story-state/story-state';
import { buildTopicRows, TOPICS_LIST_MAX, type TopicInfo } from './topic-rows';

// The «Темы» list: the topics this person could be offered, with their state in the person's
// voice and whether the queue holds them. It uses the same three finders as the top-up, so the
// privacy rules (nobody's typed topic, the NULL-interest rule, the person's styles and
// interests, heard, dismissed, rated -1) are the one set in `topic-candidates.ts`, not a copy.
// It differs from the top-up only by what it lets through: topics already queued and topics
// that finally failed are included here (the failed ones are hidden unless queued, below), and
// so are heard topics (marked `heard` and listed after the unheard ones), unless the `heard`
// filter says otherwise.
//
// `list` is a plain read: no transaction, no lock, no row changed. The one write of this
// class is `markUnheard`. Every query on a person's data is scoped by `userId`, which the
// caller takes from the verified token. Neither method creates a `generation_jobs` row
// (AGENTS.md architecture rule 10).
@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  // `ready` true: only topics that can be played at once. false: only those that cannot (the
  // query schema accepts both words, so both need a meaning). Unset: all.
  // `heard` true: only topics the person has heard. false: only the unheard. Unset: both.
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
    const heard: 'include' | 'only' | 'exclude' =
      query.heard === undefined ? 'include' : query.heard === 'true' ? 'only' : 'exclude';

    const finder = {
      userId,
      voiceId,
      limit: TOPICS_LIST_MAX,
      style: query.style,
      includeQueued: true,
      includeFailed: true,
      includeOwn: true,
      order: 'newest' as const,
      heard,
    };
    // The cap of TOPICS_LIST_MAX is applied by each finder (newest first) BEFORE the rows are
    // merged and sorted (unheard first, ready first). So a person with more than the cap of
    // matching topics in one finder can lose older rows of it, whatever their sort position.
    // No pagination in the MVP.
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

    const [topicRows, states, queueRows, heardIds] = await Promise.all([
      this.prisma.topic.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, style: true, createdAt: true },
      }),
      readStoryStates(this.prisma, voiceId, ids),
      this.prisma.queueItem.findMany({
        where: { userId, topicId: { in: ids } },
        select: { topicId: true },
      }),
      readHeardTopicIds(this.prisma, userId, ids),
    ]);
    const topics = new Map<string, TopicInfo>(
      topicRows.map((row) => [row.id, { title: row.title, style: row.style, createdAt: row.createdAt }]),
    );
    const rows = buildTopicRows({
      ids,
      topics,
      states,
      queued: new Set(queueRows.map((row) => row.topicId)),
      heard: heardIds,
      readyOnly,
    });
    return TopicsResponseSchema.parse({ topics: rows });
  }

  // Makes the topic's story unheard for this person. Heard is derived from `listens`
  // (`heard.ts`), so ALL of the person's rows for the story are deleted, in every voice,
  // partial ones included. Cost: that part of the listening history is lost for good,
  // accepted for a change with no migration and no new rule for the readers of `listens`
  // (owner, 2026-11-26; ARCHITECTURE.md section 5). `userId` in the WHERE clause is what
  // keeps other people's rows safe. The queue and the jobs are not touched. A listen report
  // that arrives after this makes the story heard again.
  async markUnheard(userId: string, topicId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      await tx.listen.deleteMany({ where: { userId, story: { topicId } } });
    });
  }
}
