import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

export interface CandidateQuery {
  userId: string;
  voiceId: string;
  // Most rows wanted; the caller passes the need.
  limit: number;
}

export interface ReadyCandidate {
  topicId: string;
  storyId: string;
}

// The dedupe keys used in the failure exclusions below are built by `dedupeKeyOf`
// (generation-jobs.service.ts); the queue items removed when such a job fails for good are
// decided in queue-waiters.ts. Change one, check the others.
const TopicRowSchema = z.object({ topic_id: z.uuid() });
const TopicStoryRowSchema = z.object({ topic_id: z.uuid(), story_id: z.uuid() });

// Conditions on the topic alone, shared by the three finders. All user-data conditions are
// scoped by `userId`. Alias: t = topics. In order:
// 1. the topic's style is one of the person's styles;
// 2. it is not already in the person's queue;
// 3. the person has not dismissed it;
// 4. SECURITY.md rule 10: text a person typed, and stories made from it, are never shown to
//    anyone else, so a topic with a 'requested' user_topics row from ANY person is never a
//    candidate. A pool-wide existence check that returns no text.
// 5. Owner decision (2026-10-30): a topic whose write_story job finally failed is not offered
//    again automatically, to anyone (the topic is unusable, not the person's fault). A
//    pool-wide existence check on the job's dedupe key; it returns no text. The key format
//    must match dedupeKeyOf in generation-jobs.service.ts.
// The interest condition is NOT here: it differs between the pool and the person's own
// topics (see poolInterestFilter and ownInterestFilter).
// No SQL comments inside the fragment: they would run into the joined text.
function topicFilters(userId: string): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM user_preferences up
      WHERE up.user_id = ${userId}::uuid AND t.style = ANY (up.styles)
    )
    AND NOT EXISTS (
      SELECT 1 FROM queue_items qi WHERE qi.user_id = ${userId}::uuid AND qi.topic_id = t.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM user_topics dt
      WHERE dt.user_id = ${userId}::uuid AND dt.topic_id = t.id AND dt.dismissed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM user_topics rt WHERE rt.topic_id = t.id AND rt.reason = 'requested'
    )
    AND NOT EXISTS (
      SELECT 1 FROM generation_jobs gj
      WHERE gj.dedupe_key = 'write_story:' || t.id::text AND gj.status = 'failed'
    )
  `;
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

// Conditions on the topic's story. Alias: s = stories. In order: the person has no listens
// row for it (heard, finished or skipped), and has not rated it -1 (other people's ratings
// are irrelevant).
function storyFilters(userId: string): Prisma.Sql {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM listens l WHERE l.user_id = ${userId}::uuid AND l.story_id = s.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM story_ratings sr
      WHERE sr.user_id = ${userId}::uuid AND sr.story_id = s.id AND sr.rating = -1
    )
  `;
}

// Pool topics that have a story and audio in the person's voice: free to queue.
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
    WHERE ${topicFilters(query.userId)}
      AND ${poolInterestFilter(query.userId)}
      AND ${storyFilters(query.userId)}
      AND EXISTS (
        SELECT 1 FROM story_audio sa WHERE sa.story_id = s.id AND sa.voice_id = ${query.voiceId}::uuid
      )
    ORDER BY random()
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicStoryRowSchema).parse(rows).map((r) => ({
    topicId: r.topic_id,
    storyId: r.story_id,
  }));
}

// Pool topics that have a story but no audio in the person's voice: need one render. Owner
// decision (2026-10-30): a story whose render for this voice finally failed is not offered
// again automatically.
export async function findRendering(
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
    WHERE ${topicFilters(query.userId)}
      AND ${poolInterestFilter(query.userId)}
      AND ${storyFilters(query.userId)}
      AND NOT EXISTS (
        SELECT 1 FROM story_audio sa WHERE sa.story_id = s.id AND sa.voice_id = ${query.voiceId}::uuid
      )
      AND NOT EXISTS (
        SELECT 1 FROM generation_jobs gj
        WHERE gj.dedupe_key = 'render_audio:' || s.id::text || ':' || ${query.voiceId}::uuid::text
          AND gj.status = 'failed'
      )
    ORDER BY random()
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicStoryRowSchema).parse(rows).map((r) => ({
    topicId: r.topic_id,
    storyId: r.story_id,
  }));
}

// The person's OWN proposed, not dismissed topics that have no story yet: need a write and
// then a render. A pool topic of another person with no story is never a candidate, because
// the join is on the person's own user_topics row. `voiceId` is unused here (a story has
// no voice); it stays in the signature so the three finders are interchangeable.
export async function findWriting(
  tx: Prisma.TransactionClient,
  query: CandidateQuery,
): Promise<string[]> {
  if (query.limit < 1) {
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
    WHERE ${topicFilters(query.userId)}
      AND ${ownInterestFilter(query.userId)}
      AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.topic_id = t.id)
    ORDER BY random()
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicRowSchema).parse(rows).map((r) => r.topic_id);
}

// A queue item of the person's OWN queue that lost the dedupe race: its topic has a story,
// there is no audio for the story in the person's voice, the person has not heard it or rated
// it -1, and NO render_audio job row of ANY status exists for that story and voice from ANY
// requester. An active job of someone with the same voice will produce the shared audio; a
// finished or failed one is not this step's business, so a failed render is NOT retried here
// and leaves the item "preparing" (failure handling, ARCHITECTURE.md section 11, item 13).
// Items are returned in queue order. The key format below must match dedupeKeyOf in
// generation-jobs.service.ts. Stalled "writing" items (no story, no write job) are not found
// either, for the same reason.
export async function findStalled(
  tx: Prisma.TransactionClient,
  query: CandidateQuery,
): Promise<ReadyCandidate[]> {
  if (query.limit < 1) {
    return [];
  }
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT qi.topic_id AS topic_id, s.id AS story_id
    FROM queue_items qi
    JOIN stories s ON s.topic_id = qi.topic_id
    WHERE qi.user_id = ${query.userId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM story_audio sa WHERE sa.story_id = s.id AND sa.voice_id = ${query.voiceId}::uuid
      )
      AND NOT EXISTS (
        SELECT 1 FROM generation_jobs gj
        WHERE gj.dedupe_key = 'render_audio:' || s.id::text || ':' || ${query.voiceId}::uuid::text
      )
      AND ${storyFilters(query.userId)}
    ORDER BY qi.position ASC
    LIMIT ${query.limit}::int
  `;
  return z.array(TopicStoryRowSchema).parse(rows).map((r) => ({
    topicId: r.topic_id,
    storyId: r.story_id,
  }));
}
