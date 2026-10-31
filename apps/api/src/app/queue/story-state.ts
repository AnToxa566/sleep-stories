import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';

export type StoryStateName = 'ready' | 'creating' | 'failed' | 'not_ready';

// The state of one topic for one person (ARCHITECTURE.md section 6, step 6, "Readiness and
// the four states"). `storyId` is set when the topic has a story, whatever the state, because
// the explicit start needs it to choose between a text and an audio job. `durationSec` and
// `storagePath` are set only for `ready`, and the path is only the one in the person's voice.
export interface StoryState {
  state: StoryStateName;
  storyId: string | null;
  durationSec: number | null;
  storagePath: string | null;
}

// What the one query returns per topic. `has_audio` is a story_audio row in the person's voice.
// `active` is a pending or running job of the next missing stage, from any requester.
// `newest_status` is the status of the newest job of that key, or null when there is none.
const StateRowSchema = z.object({
  topic_id: z.uuid(),
  story_id: z.uuid().nullable(),
  duration_sec: z.number().int().positive().nullable(),
  storage_path: z.string().min(1).nullable(),
  has_audio: z.boolean(),
  active: z.boolean(),
  newest_status: z.string().nullable(),
});

export type StateRow = z.infer<typeof StateRowSchema>;

// The rule, pure. Order matters: audio in the voice wins; then an active job of the next
// stage (any requester); then a newest job that failed; else not ready.
export function toStoryState(row: StateRow): StoryState {
  if (row.has_audio) {
    if (row.story_id === null || row.duration_sec === null || row.storage_path === null) {
      // The join guarantees these; a row that breaks it is a bug, not a state.
      throw new Error('Inconsistent story state row');
    }
    return {
      state: 'ready',
      storyId: row.story_id,
      durationSec: row.duration_sec,
      storagePath: row.storage_path,
    };
  }
  const base = { storyId: row.story_id, durationSec: null, storagePath: null };
  if (row.active) {
    return { state: 'creating', ...base };
  }
  if (row.newest_status === 'failed') {
    return { state: 'failed', ...base };
  }
  return { state: 'not_ready', ...base };
}

// Returns the state of each given topic in the person's voice. The one place where the rule
// lives; the queue read, the topics list and the explicit start all use it.
//
// Per topic: the story (if any), the audio row ONLY in `voiceId` (a join on the voice, so the
// path of audio in another voice is never selected), and the dedupe key of the next missing
// stage: `write_story:<topicId>` while there is no story, `render_audio:<storyId>:<voiceId>`
// once there is one. `IN ('pending', 'running')` is written exactly like the partial unique
// index on generation_jobs, so the index serves the lookup. The newest job decides
// `failed`, so an old failure behind a newer success or retry does not count.
//
// Reads only; no lock. Topics without a row in the result do not exist.
export async function readStoryStates(
  tx: Prisma.TransactionClient,
  voiceId: string,
  topicIds: readonly string[],
): Promise<Map<string, StoryState>> {
  const states = new Map<string, StoryState>();
  if (topicIds.length === 0) {
    return states;
  }
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT
      ids.topic_id,
      s.id AS story_id,
      sa.duration_sec,
      sa.storage_path,
      (sa.id IS NOT NULL) AS has_audio,
      EXISTS (
        SELECT 1 FROM generation_jobs a
        WHERE a.dedupe_key = k.key AND a.status IN ('pending', 'running')
      ) AS active,
      (
        SELECT g.status::text FROM generation_jobs g
        WHERE g.dedupe_key = k.key
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT 1
      ) AS newest_status
    FROM unnest(${[...topicIds]}::uuid[]) AS ids(topic_id)
    LEFT JOIN stories s ON s.topic_id = ids.topic_id
    LEFT JOIN story_audio sa ON sa.story_id = s.id AND sa.voice_id = ${voiceId}::uuid
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN s.id IS NULL THEN 'write_story:' || ids.topic_id::text
        ELSE 'render_audio:' || s.id::text || ':' || ${voiceId}::text
      END AS key
    ) k
  `;
  for (const raw of rows) {
    const row = StateRowSchema.parse(raw);
    states.set(row.topic_id, toStoryState(row));
  }
  return states;
}
