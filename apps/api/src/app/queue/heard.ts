import { LISTEN_FINISHED_SHARE } from '@sleep-stories/contracts';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

// The one definition of HEARD («прослушана») in SQL (owner decision, 2026-11-03). A story is
// heard by a person when ONE of their listens reached LISTEN_FINISHED_SHARE of the duration of
// the audio in that listen's OWN voice (the join is on the listen's `voice_id`, not on the
// person's current voice, so a changed voice cannot change an old listen). It is derived here
// and never stored (AGENTS.md architecture rule 4). `listened_sec` is the position when the
// person left; there is no check against seeking.
//
// `numeric` makes the comparison exact: 0.9 * duration in floating point can land on either
// side of a whole second. No SQL comments inside the fragment: they would run into the joined
// text. `storyId` is an SQL expression for the story, e.g. `Prisma.sql`s.id``.
export function finishedListenExists(userId: string, storyId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM listens fl
      JOIN story_audio fa ON fa.story_id = fl.story_id AND fa.voice_id = fl.voice_id
      WHERE fl.user_id = ${userId}::uuid
        AND fl.story_id = ${storyId}
        AND fl.listened_sec::numeric >= ${String(LISTEN_FINISHED_SHARE)}::numeric * fa.duration_sec
    )
  `;
}

const HeardRowSchema = z.object({ topic_id: z.uuid() });

// The topics among `topicIds` whose story this person has heard. One batched query for a whole
// list, scoped by `userId`.
export async function readHeardTopicIds(
  tx: Prisma.TransactionClient,
  userId: string,
  topicIds: readonly string[],
): Promise<Set<string>> {
  if (topicIds.length === 0) {
    return new Set();
  }
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT s.topic_id
    FROM stories s
    WHERE s.topic_id = ANY (${[...topicIds]}::uuid[])
      AND ${finishedListenExists(userId, Prisma.sql`s.id`)}
  `;
  return new Set(z.array(HeardRowSchema).parse(rows).map((row) => row.topic_id));
}
