import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import {
  LIMIT_WINDOW_HOURS,
  MAX_GENERATIONS_PER_WINDOW,
  MAX_SUGGESTIONS_PER_WINDOW,
} from '../policy/generation-policy';

export interface GenerationUsage {
  generationsUsed: number;
  suggestionsUsed: number;
}

export interface GenerationRemaining {
  generationsLeft: number;
  suggestionsLeft: number;
}

// The generation allowance as the app shows it. `activeCount` is part of `generationsUsed`.
// `firstBackAt` and `lastBackAt` are when the earliest and the latest counted success leave
// the window; both are null when no success is counted.
export interface GenerationRecovery {
  generationsUsed: number;
  activeCount: number;
  firstBackAt: Date | null;
  lastBackAt: Date | null;
}

// Postgres count() is bigint and the driver may hand it over as a bigint. The counts here
// are tiny, so converting to number is exact.
const CountSchema = z.union([z.number(), z.bigint()]).transform((value) => Number(value));
const UsageRowSchema = z.object({ generations_used: CountSchema, suggestions_used: CountSchema });
const RecoveryRowSchema = z.object({
  succeeded_count: CountSchema,
  active_count: CountSchema,
  first_back_at: z.date().nullable(),
  last_back_at: z.date().nullable(),
});

// How much of a person's rolling-window allowance is spent (ARCHITECTURE.md section 6,
// "Generation is explicit", rule 4; owner 2026-10-30 and 2026-10-31).
//
// A generation slot is spent by a succeeded `render_audio` whose finished_at is inside the
// window, and held by every `render_audio` or `write_story` that is pending or running
// (a write is followed by a render, so it holds the slot the render will use). This is exact
// only because the `write_story` handler
// creates the `render_audio` row in the same transaction that marks the `write_story` job
// succeeded: earlier a slot is counted twice, later zero times. A
// suggestion slot is spent by a succeeded `suggest_topics` in the window and held by an
// active one. Failed jobs count for nothing. The window uses the database clock only.
//
// Counts only jobs this person requested. Call it inside the transaction that holds the
// person's users-row lock, otherwise two callers can both see a free slot.
@Injectable()
export class GenerationLimitsService {
  async usage(tx: Prisma.TransactionClient, userId: string): Promise<GenerationUsage> {
    const rows = await tx.$queryRaw<unknown[]>`
      SELECT
        (
          count(*) FILTER (
            WHERE kind = 'render_audio' AND status = 'succeeded'
              AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
          )
          + count(*) FILTER (
            WHERE kind IN ('render_audio', 'write_story') AND status IN ('pending', 'running')
          )
        )::bigint AS generations_used,
        (
          count(*) FILTER (
            WHERE kind = 'suggest_topics' AND status = 'succeeded'
              AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
          )
          + count(*) FILTER (
            WHERE kind = 'suggest_topics' AND status IN ('pending', 'running')
          )
        )::bigint AS suggestions_used
      FROM generation_jobs
      WHERE requested_by_user_id = ${userId}::uuid
    `;
    const row = UsageRowSchema.parse(rows[0]);
    return { generationsUsed: row.generations_used, suggestionsUsed: row.suggestions_used };
  }

  // For display only: how many generations are spent and when they come back. It enforces
  // nothing and takes no lock; a start is decided by `usage()` under the users-row lock.
  //
  // One statement, so the counts and the times share one snapshot and one now(): a job that
  // finishes between two queries would otherwise be counted twice or not at all.
  //
  // The generation filters must stay equal to those of `usage()`, or the screen would show
  // another number than the one a start is checked against. They are repeated here so that
  // the enforcing query is not touched by a display change; queue.int-spec.ts compares the
  // two on the same jobs and guards the drift.
  async recovery(
    db: Pick<Prisma.TransactionClient, '$queryRaw'>,
    userId: string,
  ): Promise<GenerationRecovery> {
    const rows = await db.$queryRaw<unknown[]>`
      SELECT
        count(*) FILTER (
          WHERE kind = 'render_audio' AND status = 'succeeded'
            AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
        )::bigint AS succeeded_count,
        count(*) FILTER (
          WHERE kind IN ('render_audio', 'write_story') AND status IN ('pending', 'running')
        )::bigint AS active_count,
        min(finished_at) FILTER (
          WHERE kind = 'render_audio' AND status = 'succeeded'
            AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
        ) + make_interval(hours => ${LIMIT_WINDOW_HOURS}::int) AS first_back_at,
        max(finished_at) FILTER (
          WHERE kind = 'render_audio' AND status = 'succeeded'
            AND finished_at > now() - make_interval(hours => ${LIMIT_WINDOW_HOURS}::int)
        ) + make_interval(hours => ${LIMIT_WINDOW_HOURS}::int) AS last_back_at
      FROM generation_jobs
      WHERE requested_by_user_id = ${userId}::uuid
    `;
    const row = RecoveryRowSchema.parse(rows[0]);
    return {
      generationsUsed: row.succeeded_count + row.active_count,
      activeCount: row.active_count,
      firstBackAt: row.first_back_at,
      lastBackAt: row.last_back_at,
    };
  }
}

// Slots still free, never below zero.
export function remaining(usage: GenerationUsage): GenerationRemaining {
  return {
    generationsLeft: Math.max(0, MAX_GENERATIONS_PER_WINDOW - usage.generationsUsed),
    suggestionsLeft: Math.max(0, MAX_SUGGESTIONS_PER_WINDOW - usage.suggestionsUsed),
  };
}
