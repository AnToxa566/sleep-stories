import { Injectable } from '@nestjs/common';
import { GenerationJobPayloadSchema, type GenerationJobPayload } from '@sleep-stories/contracts';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';

export interface GenerationJobSpec {
  // The person the job is for (counted against their limits). Comes from the caller's
  // verified identity or from a job row, never from a request body.
  userId: string;
  // The full payload including `kind`. It is stored as parsed, so a later reader can parse
  // the column with GenerationJobPayloadSchema directly.
  payload: GenerationJobPayload;
}

const InsertedRowSchema = z.object({ id: z.uuid() });

// Key formats are also known to the failure exclusions in queue-candidates.ts and to the
// removal of waiting queue items in queue-waiters.ts: change one, check the others.
// The only place that derives a dedupe key. At most one active (pending or running) job
// per key is enforced by the partial unique index `generation_jobs_dedupe_key_active_key`.
export function dedupeKeyOf(userId: string, payload: GenerationJobPayload): string {
  switch (payload.kind) {
    case 'suggest_topics':
      return `suggest_topics:${userId}`;
    case 'write_story':
      return `write_story:${payload.topicId}`;
    case 'render_audio':
      return `render_audio:${payload.storyId}:${payload.voiceId}`;
  }
}

@Injectable()
export class GenerationJobsService {
  // Inserts a `pending` job and returns its id, or null when an active job with the same
  // dedupe key already exists (for example another person is already writing that topic).
  // ON CONFLICT DO NOTHING with no target covers the partial unique index, and concurrent
  // inserts of one key are serialised by the index: the loser gets no row back.
  async create(tx: Prisma.TransactionClient, spec: GenerationJobSpec): Promise<string | null> {
    const payload = GenerationJobPayloadSchema.parse(spec.payload);
    const key = dedupeKeyOf(spec.userId, payload);
    const rows = await tx.$queryRaw<unknown[]>`
      INSERT INTO generation_jobs (kind, payload, dedupe_key, requested_by_user_id)
      VALUES (
        ${payload.kind}::job_kind,
        ${JSON.stringify(payload)}::jsonb,
        ${key},
        ${spec.userId}::uuid
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (rows.length === 0) {
      return null;
    }
    return InsertedRowSchema.parse(rows[0]).id;
  }

  // Inserts the jobs one by one in the order of their dedupe keys and returns, for each job
  // that was created, its id together with the original item (a job whose key already has an
  // active job is omitted). The item may carry flags of the caller; they pass through
  // untouched. The order is fixed so that two concurrent transactions of different people
  // insert in the same order, which avoids deadlocks on the unique-index entries.
  async createInKeyOrder<T extends { spec: GenerationJobSpec }>(
    tx: Prisma.TransactionClient,
    userId: string,
    items: readonly T[],
  ): Promise<(T & { id: string })[]> {
    const ordered = [...items].sort((a, b) => {
      const left = dedupeKeyOf(userId, a.spec.payload);
      const right = dedupeKeyOf(userId, b.spec.payload);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const created: (T & { id: string })[] = [];
    for (const item of ordered) {
      const id = await this.create(tx, item.spec);
      if (id !== null) {
        created.push({ ...item, id });
      }
    }
    return created;
  }
}
