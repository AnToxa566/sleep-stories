// The port through which a created generation job is handed to whatever runs it. The
// abstract class is also the Nest injection token, like LlmProvider, so the queue service
// depends on this file and never on Cloud Tasks (AGENTS.md architecture rule 6).
// `jobId` is the id of a `generation_jobs` row; the payload is read from the row, never
// passed through the queue.
export abstract class JobQueue {
  abstract enqueue(jobId: string): Promise<void>;
}

// Bound when JOB_QUEUE=none (the default outside production; see job-queue.factory.ts). It
// dispatches nothing, so a created job row stays `pending` until something else runs it (the
// sweep, or a person calling the internal endpoint). env.ts refuses it in production, where
// a silent no-op queue would lose every job.
export class NoopJobQueue extends JobQueue {
  async enqueue(jobId: string): Promise<void> {
    void jobId; // Intentionally does nothing.
  }
}
