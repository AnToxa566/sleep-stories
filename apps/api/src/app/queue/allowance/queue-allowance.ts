import type { QueueResponse } from '@sleep-stories/contracts';
import { remaining, type GenerationRecovery } from '../../generation/limits/generation-limits.service';
import { MAX_GENERATIONS_PER_WINDOW } from '../../generation/policy/generation-policy';

// The `generations` block of the queue answer (ARCHITECTURE.md section 6). For display only.
//
// `nextAt` is the earliest known return. `fullAt` is null while anything is pending or
// running: that slot has no known return time (a failure frees it at once, a success keeps it
// for a whole window from its finish), so the latest known return would promise the whole
// allowance too early.
export function queueAllowance(recovery: GenerationRecovery): QueueResponse['generations'] {
  // Only the generation half of `remaining` is read; the suggestion count plays no part.
  const { generationsLeft } = remaining({
    generationsUsed: recovery.generationsUsed,
    suggestionsUsed: 0,
  });
  const fullAt = recovery.activeCount > 0 ? null : recovery.lastBackAt;
  return {
    left: generationsLeft,
    limit: MAX_GENERATIONS_PER_WINDOW,
    nextAt: recovery.firstBackAt?.toISOString() ?? null,
    fullAt: fullAt?.toISOString() ?? null,
  };
}
