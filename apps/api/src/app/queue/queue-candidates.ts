import type { StoryStyle } from '@sleep-stories/contracts';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { finishedListenExists } from './heard';

export interface CandidateQuery {
  userId: string;
  voiceId: string;
  // Most rows wanted; the caller passes the need.
  limit: number;
  // Narrowing options. Every default keeps the behaviour of the queue top-up, which wants the
  // topics that can be queued automatically. They only loosen the two top-up rules named
  // below (`includeQueued`, `includeFailed`) or narrow the result; none of them can loosen a
  // privacy rule, which stays in `topicFilters`, `poolInterestFilter` and `storyFilters`.
  //
  // Only these topics (the `topicIds` are parameters, never text in the SQL).
  topicIds?: readonly string[];
  // Only topics of this style (on top of the person's own styles, which always apply).
  style?: StoryStyle;
  // Also topics that are in the person's queue now. Default false.
  includeQueued?: boolean;
  // Also topics whose `write_story` or `render_audio` finally failed. Default false.
  includeFailed?: boolean;
  // Also, in the two story finders, the person's OWN undismissed `proposed` topics whatever
  // their interest (a topic grown from their custom interest has none), so a story made for
  // them stays reachable. Needs the person's own `proposed` user_topics row; a stranger never
  // matches, and a topic with a `requested` row stays excluded for everyone. Default false:
  // the top-up never re-queues such a topic (it only takes the pool, or an own topic with no
  // story).
  includeOwn?: boolean;
  // 'random' (default) for the top-up; 'newest' orders by topic creation, newest first.
  order?: 'random' | 'newest';
  // Heard stories (one listen reached LISTEN_FINISHED_SHARE of the audio in its own voice; see
  // `heard.ts`). 'exclude' (default) drops them, which is what every automatic choice and the
  // add/replace checks want; 'include' keeps them; 'only' keeps only them (the «Темы» filter).
  // A topic with no story is never heard, so 'only' gives nothing from `findWithoutStory`.
  heard?: 'exclude' | 'include' | 'only';
}

export interface ReadyCandidate {
  topicId: string;
  storyId: string;
}

// The dedupe keys used in the failure exclusions below are built by `dedupeKeyOf`
// (generation-jobs.service.ts). Change one, check the other.
const TopicRowSchema = z.object({ topic_id: z.uuid() });
const TopicStoryRowSchema = z.object({ topic_id: z.uuid(), story_id: z.uuid() });

// Conditions on the topic alone, shared by the three finders. All user-data conditions are
// scoped by `userId`. Alias: t = topics. In order:
// 1. the topic's style is one of the person's styles;
// 2. it is not already in the person's queue (unless `includeQueued`);
// 3. the person has not dismissed it;
// 4. SECURITY.md rule 10: text a person typed, and stories made from it, are never shown to
//    anyone else, so a topic with a 'requested' user_topics row from ANY person is never a
//    candidate. A pool-wide existence check that returns no text. Unconditional.
// 5. Owner decision (2026-10-30): a topic whose write_story job finally failed is not offered
//    again automatically, to anyone (the topic is unusable, not the person's fault), unless
//    `includeFailed`. A pool-wide existence check on the job's dedupe key; it returns no
//    text. The key format must match dedupeKeyOf in generation-jobs.service.ts.
// 6. The optional narrowing: `topicIds` and `style`.
// The interest condition is NOT here: it differs between the pool and the person's own
// topics (see poolInterestFilter and ownInterestFilter).
// No SQL comments inside the fragment: they would run into the joined text.
function topicFilters(query: CandidateQuery): Prisma.Sql {
  const { userId } = query;
  const notQueued = query.includeQueued
    ? Prisma.empty
    : Prisma.sql`
    AND NOT EXISTS (
      SELECT 1 FROM queue_items qi WHERE qi.user_id = ${userId}::uuid AND qi.topic_id = t.id
    )`;
  const noFailedWrite = query.includeFailed
    ? Prisma.empty
    : Prisma.sql`
    AND NOT EXISTS (
      SELECT 1 FROM generation_jobs gj
      WHERE gj.dedupe_key = 'write_story:' || t.id::text AND gj.status = 'failed'
    )`;
  const onlyTopics =
    query.topicIds === undefined
      ? Prisma.empty
      : Prisma.sql`AND t.id = ANY (${[...query.topicIds]}::uuid[])`;
  const onlyStyle =
    query.style === undefined ? Prisma.empty : Prisma.sql`AND t.style::text = ${query.style}`;
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM user_preferences up
      WHERE up.user_id = ${userId}::uuid AND t.style = ANY (up.styles)
    )
    ${notQueued}
    AND NOT EXISTS (
      SELECT 1 FROM user_topics dt
      WHERE dt.user_id = ${userId}::uuid AND dt.topic_id = t.id AND dt.dismissed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM user_topics rt WHERE rt.topic_id = t.id AND rt.reason = 'requested'
    )
    ${noFailedWrite}
    ${onlyTopics}
    ${onlyStyle}
  `;
}

// Row order of a finder. `random` is the top-up's; `newest` makes a list stable.
function orderBy(query: CandidateQuery): Prisma.Sql {
  return query.order === 'newest'
    ? Prisma.sql`ORDER BY t.created_at DESC, t.id`
    : Prisma.sql`ORDER BY random()`;
}

// Interest rule for topics taken from the shared pool: the topic's interest must be one of
// the person's interests, and a NULL interest NEVER matches. This is a privacy rule
// (SECURITY.md rule 10): a topic grown from someone's own custom interest has no catalogue
// interest, so it can never reach another person's queue through the pool.
function poolInterestFilter(userId: string): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM user_interests ui
      WHERE ui.user_id = ${userId}::uuid AND ui.interest_id = t.interest_id
    )
  `;
}

// The interest rule of the two story finders. By default the pool rule. With `includeOwn` a
// topic also matches when the person has their own undismissed `proposed` row for it, whatever
// its interest. The join is on the person's own row, so another person never matches
// through it (SECURITY.md rule 10).
function storyInterestFilter(query: CandidateQuery): Prisma.Sql {
  if (query.includeOwn !== true) {
    return poolInterestFilter(query.userId);
  }
  return Prisma.sql`
    (
      ${poolInterestFilter(query.userId)}
      OR EXISTS (
        SELECT 1 FROM user_topics own
        WHERE own.user_id = ${query.userId}::uuid
          AND own.topic_id = t.id
          AND own.reason = 'proposed'
          AND own.dismissed_at IS NULL
      )
    )
  `;
}

// Interest rule for the person's OWN proposed topics: a NULL interest is allowed (a topic
// made for their custom interest), otherwise it must be one of their interests. Safe because
// the finder joins on the person's own user_topics row.
function ownInterestFilter(userId: string): Prisma.Sql {
  return Prisma.sql`
    (
      t.interest_id IS NULL
      OR EXISTS (
        SELECT 1 FROM user_interests ui
        WHERE ui.user_id = ${userId}::uuid AND ui.interest_id = t.interest_id
      )
    )
  `;
}

// Conditions on the topic's story. Alias: s = stories. In order: the heard rule (see
// `CandidateQuery.heard`; the definition of heard is `finishedListenExists`, so a listen that
// stopped early does not hide the story), and the person has not rated it -1 (other people's
// ratings are irrelevant).
function storyFilters(query: CandidateQuery): Prisma.Sql {
  const { userId } = query;
  const heard = query.heard ?? 'exclude';
  const finished = finishedListenExists(userId, Prisma.sql`s.id`);
  const heardRule =
    heard === 'include'
      ? Prisma.sql`TRUE`
      : heard === 'only'
        ? finished
        : Prisma.sql`NOT ${finished}`;
  return Prisma.sql`
    ${heardRule}
    AND NOT EXISTS (
      SELECT 1 FROM story_ratings sr
      WHERE sr.user_id = ${userId}::uuid AND sr.story_id = s.id AND sr.rating = -1
    )
  `;
}

// Pool topics that have a story and audio in the person's voice: ready to play.
export async function findReady(
  tx: Prisma.TransactionClient,
  query: CandidateQuery,
): Promise<ReadyCandidate[]> {
  if (query.limit < 1) {
    return [];
  }
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT t.id AS topic_id, s.id AS story_id
    FROM topics t
    JOIN stories s ON s.topic_id = t.id
    WHERE ${topicFilters(query)}
      AND ${storyInterestFilter(query)}
      AND ${storyFilters(query)}
      AND EXISTS (
        SELECT 1 FROM story_audio sa WHERE sa.story_id = s.id AND sa.voice_id = ${query.voiceId}::uuid
      )
    ${orderBy(query)}
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicStoryRowSchema).parse(rows).map((r) => ({
    topicId: r.topic_id,
    storyId: r.story_id,
  }));
}

// Pool topics that have a story but no audio in the person's voice (`not_ready`). Owner
// decision (2026-10-30): a story whose render for this voice finally failed is not offered
// again automatically.
export async function findWithoutAudio(
  tx: Prisma.TransactionClient,
  query: CandidateQuery,
): Promise<ReadyCandidate[]> {
  if (query.limit < 1) {
    return [];
  }
  // The exclusion of a finally failed render in this voice; skipped with `includeFailed`.
  const noFailedRender = query.includeFailed
    ? Prisma.empty
    : Prisma.sql`AND NOT EXISTS (
        SELECT 1 FROM generation_jobs gj
        WHERE gj.dedupe_key = 'render_audio:' || s.id::text || ':' || ${query.voiceId}::uuid::text
          AND gj.status = 'failed'
      )`;
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT t.id AS topic_id, s.id AS story_id
    FROM topics t
    JOIN stories s ON s.topic_id = t.id
    WHERE ${topicFilters(query)}
      AND ${storyInterestFilter(query)}
      AND ${storyFilters(query)}
      AND NOT EXISTS (
        SELECT 1 FROM story_audio sa WHERE sa.story_id = s.id AND sa.voice_id = ${query.voiceId}::uuid
      )
      ${noFailedRender}
    ${orderBy(query)}
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicStoryRowSchema).parse(rows).map((r) => ({
    topicId: r.topic_id,
    storyId: r.story_id,
  }));
}

// The person's OWN proposed, not dismissed topics that have no story yet (`not_ready`). A pool
// topic of another person with no story is never a candidate, because the join is on the
// person's own user_topics row. `voiceId` is unused here (a story has
// no voice); it stays in the signature so the finders are interchangeable.
export async function findWithoutStory(
  tx: Prisma.TransactionClient,
  query: CandidateQuery,
): Promise<string[]> {
  if (query.limit < 1 || query.heard === 'only') {
    return [];
  }
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT t.id AS topic_id
    FROM topics t
    JOIN user_topics own
      ON own.topic_id = t.id
     AND own.user_id = ${query.userId}::uuid
     AND own.reason = 'proposed'
     AND own.dismissed_at IS NULL
    WHERE ${topicFilters(query)}
      AND ${ownInterestFilter(query.userId)}
      AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.topic_id = t.id)
    ${orderBy(query)}
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicRowSchema).parse(rows).map((r) => r.topic_id);
}

// The topics among `topicIds` that this person may be given right now: the union of the three
// finders with the same privacy rules as the top-up, so a topic id sent by a client is
// checked by exactly the rules that choose topics for the queue. A topic that is missing, is
// someone's typed topic, is outside the person's styles or interests, was heard (unless `heard`
// says otherwise), dismissed or rated -1 is simply not in the set, so the caller cannot tell the reasons apart. `limit` is
// the number of ids asked about, so no eligible id is cut off. Run it inside the transaction
// that also writes, behind `lockUserRow`.
export async function findEligible(
  tx: Prisma.TransactionClient,
  query: {
    userId: string;
    voiceId: string;
    topicIds: readonly string[];
    includeQueued?: boolean;
    includeFailed?: boolean;
    includeOwn?: boolean;
    heard?: 'exclude' | 'include' | 'only';
  },
): Promise<Set<string>> {
  const narrowed: CandidateQuery = { ...query, limit: query.topicIds.length };
  const ready = await findReady(tx, narrowed);
  const withoutAudio = await findWithoutAudio(tx, narrowed);
  const withoutStory = await findWithoutStory(tx, narrowed);
  return new Set([
    ...ready.map((row) => row.topicId),
    ...withoutAudio.map((row) => row.topicId),
    ...withoutStory,
  ]);
}
