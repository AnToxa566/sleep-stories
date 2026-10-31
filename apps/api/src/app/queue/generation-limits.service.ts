import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import {
  LIMIT_WINDOW_HOURS,
  MAX_GENERATIONS_PER_WINDOW,
  MAX_SUGGESTIONS_PER_WINDOW,
} from './queue-policy';

export interface GenerationUsage {
  generationsUsed: number;
  suggestionsUsed: number;
}

export interface GenerationRemaining {
  generationsLeft: number;
  suggestionsLeft: number;
}

// Postgres count() is bigint and the driver may hand it over as a bigint. The counts here
// are tiny, so converting to number is exact.
const CountSchema = z.union([z.number(), z.bigint()]).transform((value) => Number(value));
const UsageRowSchema = z.object({ generations_used: CountSchema, suggestions_used: CountSchema });

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
}

// Slots still free, never below zero.
export function remaining(usage: GenerationUsage): GenerationRemaining {
  return {
    generationsLeft: Math.max(0, MAX_GENERATIONS_PER_WINDOW - usage.generationsUsed),
    suggestionsLeft: Math.max(0, MAX_SUGGESTIONS_PER_WINDOW - usage.suggestionsUsed),
  };
}
