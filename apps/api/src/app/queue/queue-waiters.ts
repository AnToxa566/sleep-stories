import type { GenerationJobPayload } from '@sleep-stories/contracts';
import type { Prisma } from '../../generated/prisma/client';

// Who waits for which job key. Three places know the key formats and must agree:
// `dedupeKeyOf` (generation-jobs.service.ts) builds the keys, the candidate finders
// (queue-candidates.ts) exclude the keys that failed, and this function removes the queue
// items that were waiting for a key that failed for good. Change one, check the others.
//
// Called by the job runner when a job fails for good (owner decision 2026-10-30, "remove for
// everyone who was waiting"), inside the transaction that marks the job `failed` and only
// when that fenced update matched. No user-intent data is written.
// - write_story for topic T: no story will exist, so every person's item for T goes.
// - render_audio for story S in voice V: the people whose preference voice is V lose their
//   item for S's topic. A person with another voice has a render job and key of their own
//   and keeps theirs; a person with no preferences is not waiting on this key. The
//   requester is not special-cased: if they changed voice since, a new key serves them.
// - suggest_topics: no queue item depends on it.
export async function removeWaitingItems(
  tx: Prisma.TransactionClient,
  payload: GenerationJobPayload,
): Promise<void> {
  switch (payload.kind) {
    case 'write_story':
      await tx.$executeRaw`
        DELETE FROM queue_items
        WHERE topic_id = ${payload.topicId}::uuid
      `;
      return;
    case 'render_audio':
      await tx.$executeRaw`
        DELETE FROM queue_items qi
        USING user_preferences up
        WHERE qi.topic_id = (SELECT topic_id FROM stories WHERE id = ${payload.storyId}::uuid)
          AND up.user_id = qi.user_id
          AND up.voice_id = ${payload.voiceId}::uuid
      `;
      return;
    case 'suggest_topics':
      return;
  }
}
