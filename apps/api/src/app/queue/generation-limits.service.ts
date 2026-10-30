import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import {
  LIMIT_WINDOW_HOURS,
  MAX_RENDERS_PER_WINDOW,
  MAX_SUGGESTIONS_PER_WINDOW,
} from './queue-policy';

export interface GenerationUsage {
  rendersUsed: number;
  suggestionsUsed: number;
}

export interface GenerationRemaining {
  rendersLeft: number;
  suggestionsLeft: number;
}

// Postgres count() is bigint and the driver may hand it over as a bigint. The counts here
// are tiny, so converting to number is exact.
const CountSchema = z.union([z.number(), z.bigint()]).transform((value) => Number(value));
const UsageRowSchema = z.object({ renders_used: CountSchema, suggestions_used: CountSchema });

// How much of a person's rolling-window allowance is spent (ARCHITECTURE.md section 6,
// "Queue top-up and the daily limit", owner 2026-10-30).
//
// A render slot is spent by a succeeded `render_audio` whose finished_at is inside the
// window, and held by every `render_audio` or `write_story` that is pending or running
// (a write is followed by a render, so it holds the slot the render will use). This is exact
// only if cycle 3b creates the `render_audio` row in the same transaction that marks the
// `write_story` job succeeded: earlier a slot is counted twice, later zero times. A
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
        )::bigint AS renders_used,
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
    return { rendersUsed: row.renders_used, suggestionsUsed: row.suggestions_used };
  }
}

// Slots still free, never below zero.
export function remaining(usage: GenerationUsage): GenerationRemaining {
  return {
    rendersLeft: Math.max(0, MAX_RENDERS_PER_WINDOW - usage.rendersUsed),
    suggestionsLeft: Math.max(0, MAX_SUGGESTIONS_PER_WINDOW - usage.suggestionsUsed),
  };
}
