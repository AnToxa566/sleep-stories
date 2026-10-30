// The port through which a created generation job is handed to whatever runs it. The
// abstract class is also the Nest injection token, like LlmProvider, so the queue service
// depends on this file and never on Cloud Tasks (AGENTS.md architecture rule 6).
// `jobId` is the id of a `generation_jobs` row; the payload is read from the row, never
// passed through the queue.
export abstract class JobQueue {
  abstract enqueue(jobId: string): Promise<void>;
}

// Placeholder bound in ProvidersModule. It buys a compilable top-up flow before the runner
// exists; it costs that nothing dispatches jobs, so a created job row stays `pending`.
// Cycle 3b replaces it with a local direct-call queue and a Cloud Tasks one, and makes a
// production boot without a real queue refuse to start.
export class NoopJobQueue extends JobQueue {
  async enqueue(jobId: string): Promise<void> {
    void jobId; // Intentionally does nothing.
  }
}
