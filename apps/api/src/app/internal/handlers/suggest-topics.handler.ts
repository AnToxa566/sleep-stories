import { randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { StoryStyle } from '@sleep-stories/contracts';
import { z } from 'zod';
import { GenerationError } from '../../generation/generation-error';
import { TopicSuggesterService } from '../../generation/topic-suggester.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_TARGET_LENGTH } from '../../queue/queue-policy';
import type { JobContext, JobHandler } from '../job-handler';

// How many of the person's latest topics the model is told not to repeat.
const EXISTING_TOPICS_LIMIT = 150;

const UserRowsSchema = z.array(z.object({ id: z.uuid() }));

interface NewTopic {
  id: string;
  title: string;
  style: StoryStyle;
  // NULL for every topic that came from the person's own words (open problem 29).
  interestId: string | null;
}

// Makes new topics for one person and queues some of them as `not_ready` items
// (ARCHITECTURE.md section 6, "Queue top-up" and "How jobs run"; section 11 item 29). It
// creates no story job: text and audio are made only by an explicit start of the person
// (AGENTS.md architecture rule 10).
//
// Privacy is structural, not a matter of prompt wording (SECURITY.md rule 10). The model is
// called up to twice. Call A sees the styles and the person's catalogue interests, never
// their typed ones, and as "existing topics" never a topic derived from them or typed by the
// person (a NULL interest, or a `requested` row). Call B runs only when the person typed
// interests and sees those, never the catalogue ones. Everything call B returns is stored with a NULL interest whatever the
// model answered, and the shared pool never matches a NULL interest, so a topic grown from
// someone's own words cannot reach another person's queue. The cost: a person with typed
// interests pays for two calls.
//
// The person and the payload come from the job row only. Model calls hold no transaction.
// The rows and the queue items are written in ONE transaction behind the same users-row lock
// the top-up takes, with `markSucceeded` as its last statement: a run whose lease was lost
// rolls the whole step back. Nothing is logged by this handler: no ids, titles or model
// output.
@Injectable()
export class SuggestTopicsHandler implements JobHandler<'suggest_topics'> {
  readonly kind = 'suggest_topics' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly suggester: TopicSuggesterService,
  ) {}

  async run(ctx: JobContext<'suggest_topics'>): Promise<void> {
    const userId = ctx.job.userId;
    if (userId === null) {
      throw new GenerationError('job_target_missing', false);
    }

    // 1. The person's context, read outside any transaction.
    const preferences = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { styles: true },
    });
    if (preferences === null) {
      throw new GenerationError('job_target_missing', false);
    }
    const styles: StoryStyle[] = preferences.styles;

    const chosen = await this.prisma.userInterest.findMany({
      where: { userId, interest: { isActive: true } },
      select: { interest: { select: { id: true, slug: true, title: true, sortOrder: true } } },
    });
    const catalogue = chosen
      .map((row) => row.interest)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    const interestIdBySlug = new Map(catalogue.map((interest) => [interest.slug, interest.id]));

    // Untrusted text typed by the person. Only call B ever receives it.
    const custom = await this.prisma.userCustomInterest.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { title: true },
    });
    const customTitles = custom.map((row) => row.title);

    // Two lists of titles the model is told not to repeat (SECURITY.md rule 10).
    // - For call A (its output is stored with a catalogue interest in the SHARED pool): only
    //   the person's topics that have a catalogue interest and that nobody requested by
    //   typing. A topic with a NULL interest was written from typed interests, and a
    //   `requested` topic is the person's own typed text; naming either in call A could
    //   carry it into a topic other people are offered. Same exclusion as the pool finders.
    // - For call B (its output is private and stored with a NULL interest): the whole
    //   history, so the model does not repeat the person's own words.
    // Both are the person's 150 latest rows by recency of their own `user_topics` row.
    const offeredToCatalogue = await this.prisma.userTopic.findMany({
      where: {
        userId,
        topic: { interestId: { not: null }, userTopics: { none: { reason: 'requested' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXISTING_TOPICS_LIMIT,
      select: { topic: { select: { title: true, style: true } } },
    });
    const history = await this.prisma.userTopic.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: EXISTING_TOPICS_LIMIT,
      select: { topic: { select: { title: true, style: true } } },
    });
    const catalogueExisting = offeredToCatalogue.map((row) => row.topic);
    const fullHistory = history.map((row) => row.topic);

    if (catalogue.length === 0 && customTitles.length === 0) {
      throw new GenerationError('job_target_missing', false);
    }

    // 2. The model calls, one after the other. An error from either fails the attempt.
    const fresh: NewTopic[] = [];
    let addedByCallA: { title: string; style: StoryStyle }[] = [];
    if (catalogue.length > 0) {
      const result = await this.suggester.suggest({
        styles,
        interests: catalogue.map(({ slug, title }) => ({ slug, title })),
        customInterests: [],
        existingTopics: catalogueExisting,
      });
      for (const topic of result.topics) {
        // The service kept only slugs that were offered, so the lookup finds the id.
        const slug = topic.interest;
        fresh.push(toNewTopic(topic, slug === null ? null : (interestIdBySlug.get(slug) ?? null)));
      }
      addedByCallA = result.topics.map(({ title, style }) => ({ title, style }));
    }
    if (customTitles.length > 0) {
      const result = await this.suggester.suggest({
        styles,
        interests: [],
        customInterests: customTitles,
        existingTopics: [...fullHistory, ...addedByCallA],
      });
      // NULL whatever the model answered: this is the isolation of open problem 29.
      for (const topic of result.topics) {
        fresh.push(toNewTopic(topic, null));
      }
    }

    // 3. One transaction: lock, rows, queue, success.
    // The lock comes first and explicitly. The foreign-key inserts below also take a share
    // lock on the users row, which would order this step against the top-up by accident; the
    // explicit lock does not depend on the order of the inserts (checked by removing both).
    await this.prisma.$transaction(async (tx) => {
      const locked = UserRowsSchema.parse(
        await tx.$queryRaw<unknown[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`,
      );
      if (locked.length === 0) {
        throw new GenerationError('job_target_missing', false);
      }
      const current = await tx.userPreference.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (current === null) {
        throw new GenerationError('job_target_missing', false);
      }
      if (fresh.length > 0) {
        await tx.topic.createMany({
          data: fresh.map(({ id, title, style, interestId }) => ({ id, title, style, interestId })),
        });
        await tx.userTopic.createMany({
          data: fresh.map(({ id }) => ({ userId, topicId: id, reason: 'proposed' as const })),
        });
      }

      // At most what is missing and what fits in the queue, chosen at random. The others
      // only appear on the person's list of topics. A topic is never queued because a job
      // was created for it: no story job exists any more.
      const queueLength = await tx.queueItem.count({ where: { userId } });
      const slots = Math.max(0, Math.min(ctx.job.payload.missing, QUEUE_TARGET_LENGTH - queueLength));
      const toQueue = shuffle(fresh.map(({ id }) => id)).slice(0, slots);
      if (toQueue.length > 0) {
        const last = await tx.queueItem.aggregate({ where: { userId }, _max: { position: true } });
        const firstPosition = (last._max.position ?? 0) + 1;
        await tx.queueItem.createMany({
          data: toQueue.map((topicId, index) => ({
            userId,
            topicId,
            position: firstPosition + index,
          })),
        });
      }

      await ctx.markSucceeded(tx);
    });
  }
}

function toNewTopic(
  topic: { title: string; style: StoryStyle },
  interestId: string | null,
): NewTopic {
  return { id: randomUUID(), title: topic.title, style: topic.style, interestId };
}

// Fisher-Yates with a cryptographic source; the result is a new array.
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
