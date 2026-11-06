import { Logger } from '@nestjs/common';
import type { CloudTasksClient, protos } from '@google-cloud/tasks';
import { JOB_LEASE_MINUTES } from '../../queue/queue-policy';
import { JobQueue } from './job-queue';

// The production JobQueue: one Cloud Task per generation job (AGENTS.md architecture rule 6;
// ARCHITECTURE.md section 6, step 2, and section 12). This file is the only place that imports
// `@google-cloud/tasks` (architecture.spec.ts enforces it).
//
// The task is a plain HTTP POST to this same service, `/api/internal/jobs/run` with
// `{ "jobId": ... }`, signed with a Google OIDC token that `GoogleOidcVerifier` checks. The
// payload is never passed through the queue: the endpoint reads it from the job row.

// The path the controller serves (LocalJobQueue spells the same path by hand).
export const RUN_JOB_PATH = '/api/internal/jobs/run';

// What the adapter needs from the SDK client. Tests inject a fake.
export interface CloudTasksClientLike {
  createTask(
    request: protos.google.cloud.tasks.v2.ICreateTaskRequest,
    options: CloudTasksCallOptions,
  ): Promise<unknown>;
}

// Per call. `retry: null` switches the SDK's own retries off and `timeout` is the explicit
// client-side limit in milliseconds (see CALL_OPTIONS).
export interface CloudTasksCallOptions {
  timeout: number;
  retry: null;
}

// ARCHITECTURE.md section 4 ("maxRetries: 0 in both adapters"): hidden SDK retries would
// double the work without anyone counting it, and a failed createTask is recovered by the
// sweep, which re-enqueues every stale pending job. `createTask` is not idempotent for the
// SDK (its default retry list is empty), so `retry: null` only makes that explicit and
// immune to a changed default. The timeout keeps the HTTP request that triggered the
// enqueue from hanging on a slow Google endpoint (the SDK default is 20 s).
const CALL_OPTIONS: CloudTasksCallOptions = { timeout: 10_000, retry: null };

// The deadline Cloud Tasks gives the API to answer one dispatch. It is the lease plus one
// minute, so it follows the lease. The Cloud Run `--timeout` is set to the lease itself at
// deployment (600 s; ARCHITECTURE.md section 11, item 7), so Cloud Run always ends a request
// no later than Cloud Tasks stops waiting for it, and no run outlives its lease.
const DISPATCH_DEADLINE_SECONDS = (JOB_LEASE_MINUTES + 1) * 60;

export interface CloudTasksOidcSettings {
  // INTERNAL_OIDC_AUDIENCE, passed to Cloud Tasks unchanged: GoogleOidcVerifier compares
  // the `aud` of the token with this exact string, so it is not normalised here.
  audience: string;
  // INTERNAL_OIDC_SERVICE_ACCOUNT: the account Cloud Tasks signs the token as.
  serviceAccountEmail: string;
}

export class CloudTasksJobQueue extends JobQueue {
  private readonly logger = new Logger(CloudTasksJobQueue.name);
  private readonly url: string;

  constructor(
    private readonly client: CloudTasksClientLike,
    // projects/<project>/locations/<location>/queues/<queue>
    private readonly queuePath: string,
    private readonly oidc: CloudTasksOidcSettings,
  ) {
    super();
    // Where Cloud Tasks posts: the origin (scheme, host, port) of the audience plus the run
    // path. The audience is the service URL; if it carries a path or a trailing slash, only
    // the origin is used for the target, while the token audience keeps the exact string.
    // It comes from configuration (env.ts has checked it is an https URL), never from input.
    this.url = `${new URL(oidc.audience).origin}${RUN_JOB_PATH}`;
  }

  // Never throws: the callers create the job row first and swallow errors anyway, and a job
  // that was not enqueued stays `pending` until the sweep picks it up (SWEEP_PENDING_AFTER_MINUTES).
  // The task has NO name. A named task cannot be created again for about an hour after it
  // ran, and the sweep deliberately enqueues the same job id again; the claim in the executor
  // makes two tasks for one job harmless, so duplicates are allowed and names are not used.
  // Attempts (3/2/2) live in the database claim; the queue's own retry settings only need
  // headroom above them (set at deployment). On failure one fixed line is logged, with the
  // numeric status code at most: no job id, no queue path, no error text (SECURITY.md rule 9).
  async enqueue(jobId: string): Promise<void> {
    try {
      await this.client.createTask(
        {
          parent: this.queuePath,
          task: {
            httpRequest: {
              httpMethod: 'POST',
              url: this.url,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(JSON.stringify({ jobId })),
              oidcToken: {
                serviceAccountEmail: this.oidc.serviceAccountEmail,
                audience: this.oidc.audience,
              },
            },
            dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
          },
        },
        CALL_OPTIONS,
      );
    } catch (error) {
      const code = numericCode(error);
      this.logger.warn(
        code === null
          ? 'Cloud Tasks queue: the job was not enqueued'
          : `Cloud Tasks queue: the job was not enqueued (code ${code})`,
      );
    }
  }
}

// The gRPC / HTTP status number of a Google API error, or null. Nothing else of the error
// is read, so no text of it can reach a log.
function numericCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code < 1000) {
      return code;
    }
  }
  return null;
}

export interface CloudTasksQueueSettings extends CloudTasksOidcSettings {
  projectId: string;
  location: string;
  queue: string;
}

// The format of CloudTasksClient.queuePath(project, location, queue); a test compares them.
export function queuePathOf(settings: Pick<CloudTasksQueueSettings, 'projectId' | 'location' | 'queue'>): string {
  return `projects/${settings.projectId}/locations/${settings.location}/queues/${settings.queue}`;
}

// The only place the real client is built, and it is built on the first enqueue, not at boot:
// starting the API calls no Google service, and the SDK (a large dependency tree) is not even
// loaded in a process that never enqueues. `fallback: 'rest'` makes the client talk plain
// HTTPS/JSON instead of gRPC. It buys a request-per-call transport that has no long-lived
// HTTP/2 channel to go stale while Cloud Run scales to zero, and no native gRPC channel setup;
// it costs a slightly larger request body (JSON) and a transport the SDK calls a fallback.
// Credentials are Application Default Credentials: on Cloud Run, the runtime service account.
// Nothing key-like is read from the environment or the code.
export function createCloudTasksJobQueue(settings: CloudTasksQueueSettings): CloudTasksJobQueue {
  let client: Promise<CloudTasksClient> | undefined;
  const lazyClient: CloudTasksClientLike = {
    async createTask(request, options) {
      const loading = (client ??= import('@google-cloud/tasks').then(
        (sdk) => new sdk.CloudTasksClient({ fallback: 'rest' }),
      ));
      let ready: CloudTasksClient;
      try {
        ready = await loading;
      } catch (error) {
        // A failed load or construction is not cached for ever: the next enqueue tries again.
        // Only the promise that failed is dropped (a newer one stays), and a failed
        // createTask call below never touches the client.
        if (client === loading) {
          client = undefined;
        }
        throw error;
      }
      return ready.createTask(request, options);
    },
  };
  return new CloudTasksJobQueue(lazyClient, queuePathOf(settings), {
    audience: settings.audience,
    serviceAccountEmail: settings.serviceAccountEmail,
  });
}
