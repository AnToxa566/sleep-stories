import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { JobQueue } from './job-queue';
import type { LocalDispatchSecret } from './local-dispatch-secret';

// =====================================================================================
// DEVELOPMENT ONLY. This is the single exception to the rule "no work after the HTTP
// response" (AGENTS.md architecture rule 6; ARCHITECTURE.md section 11, item 7, owner
// decision 2026-10-30). enqueue() starts an HTTP POST to this same process and returns at
// once; the job then runs inside that request, not inside the call that created it.
// It buys a way to run the real executor on a laptop without Cloud Tasks; it costs a
// fire-and-forget request that is lost if the process stops. env.ts refuses JOB_QUEUE=local
// in production and on Cloud Run, so this class cannot be selected there.
// =====================================================================================

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export interface LocalJobQueueOptions {
  // The wait before the second and the third post after a 503. Injectable for tests.
  retryDelaysMs?: readonly number[];
  // Per post. The job runs inside the request, so this is generous.
  timeoutMs?: number;
  fetchFunction?: FetchFunction;
}

const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000] as const;
const TEN_MINUTES_MS = 10 * 60_000;

export class LocalJobQueue extends JobQueue {
  private readonly logger = new Logger(LocalJobQueue.name);
  private readonly retryDelaysMs: readonly number[];
  private readonly timeoutMs: number;
  private readonly fetchFunction: FetchFunction;

  constructor(
    private readonly secret: LocalDispatchSecret,
    private readonly httpAdapterHost: HttpAdapterHost,
    options: LocalJobQueueOptions = {},
  ) {
    super();
    // At most delays.length + 1 posts in total: a hard cap so a bug cannot loop.
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.timeoutMs = options.timeoutMs ?? TEN_MINUTES_MS;
    this.fetchFunction = options.fetchFunction ?? ((url, init) => fetch(url, init));
  }

  // Returns without waiting for the job. Never throws and never logs the job id, the
  // secret, the URL or an error text.
  async enqueue(jobId: string): Promise<void> {
    try {
      const port = this.listeningPort();
      if (port === null) {
        this.logger.warn('Local job queue: the server is not listening, the job was not dispatched');
        return;
      }
      void this.post(jobId, `http://127.0.0.1:${port}/api/internal/jobs/run`, 0);
    } catch {
      this.logger.warn('Local job queue: dispatch failed');
    }
  }

  // The port is read when a job is enqueued, from the running HTTP server.
  private listeningPort(): number | null {
    const server = this.httpAdapterHost.httpAdapter?.getHttpServer() as
      | { address(): unknown }
      | undefined;
    const address = server?.address();
    if (typeof address === 'object' && address !== null && 'port' in address) {
      const port = (address as { port: unknown }).port;
      return typeof port === 'number' && port > 0 ? port : null;
    }
    return null;
  }

  private async post(jobId: string, url: string, postsMade: number): Promise<void> {
    let retryable = false;
    try {
      const response = await this.fetchFunction(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secret.value}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // 503 is the endpoint's "try again later" (retry or a job still running).
      retryable = response.status === 503;
      // Free the connection; the body is never read.
      await response.body?.cancel().catch(() => undefined);
    } catch {
      this.logger.warn('Local job queue: a dispatch request failed');
      return;
    }
    const delay = this.retryDelaysMs[postsMade];
    if (!retryable || delay === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      void this.post(jobId, url, postsMade + 1);
    }, delay);
    // A pending retry must never keep the process (or Jest) alive.
    timer.unref();
  }
}
