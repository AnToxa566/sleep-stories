import { Inject, Injectable, Optional } from '@nestjs/common';
import type { GenerationJobPayload, JobKind } from '@sleep-stories/contracts';
import type { Prisma } from '../../generated/prisma/client';

// Thrown by markSucceeded when the job is no longer this run's: the lease was taken over
// (or the job already finished). The run must stop; whatever else it wrote in the same
// transaction rolls back with this error. The runner treats it as "someone else owns the
// job now" and changes nothing. The message is fixed.
export class JobLeaseLostError extends Error {
  constructor() {
    super('The job lease was lost');
    this.name = 'JobLeaseLostError';
  }
}

type PayloadOf<K extends JobKind> = Extract<GenerationJobPayload, { kind: K }>;

// What a handler gets for one run. `payload` was parsed from the job row; `userId` is the
// requester stored on the row (null when that person was deleted). `attempt` is the number
// of this claim, starting at 1.
export interface JobContext<K extends JobKind = JobKind> {
  job: {
    id: string;
    kind: K;
    userId: string | null;
    payload: PayloadOf<K>;
    attempt: number;
  };
  // The handler MUST call this inside its own transaction, as the last write: the rows it
  // produced and the job's success then commit together. It is fenced on the claim: when
  // the lease was taken over it throws JobLeaseLostError and the transaction rolls back.
  markSucceeded(tx: Prisma.TransactionClient): Promise<void>;
}

export interface JobHandler<K extends JobKind = JobKind> {
  readonly kind: K;
  run(context: JobContext<K>): Promise<void>;
}

// Injection token for the handlers (a multi-provider array built by the module that
// registers them). No handler registered is valid: the runner then answers `retry` for every job and leaves the row alone.
export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

@Injectable()
export class JobHandlerRegistry {
  private readonly byKind = new Map<JobKind, JobHandler>();

  constructor(@Optional() @Inject(JOB_HANDLERS) handlers?: JobHandler[]) {
    for (const handler of handlers ?? []) {
      if (this.byKind.has(handler.kind)) {
        // Two handlers for one kind would make the choice depend on array order.
        throw new Error(`Two job handlers are registered for kind ${handler.kind}`);
      }
      this.byKind.set(handler.kind, handler);
    }
  }

  get(kind: JobKind): JobHandler | undefined {
    return this.byKind.get(kind);
  }
}
