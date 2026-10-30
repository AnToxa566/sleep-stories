import type { HttpAdapterHost } from '@nestjs/core';
import type { JobQueueMode } from '../../config/env';
import { JobQueue, NoopJobQueue } from './job-queue';
import type { LocalDispatchSecret } from './local-dispatch-secret';
import { LocalJobQueue } from './local-job-queue';

// Chooses the JobQueue by JOB_QUEUE. env.ts already refuses `none` and `local` in
// production and on Cloud Run, so a production boot cannot get a queue that loses or
// self-posts jobs. `cloud-tasks` is accepted by the env schema but has no implementation
// yet, so the API refuses to start with it rather than silently dispatching nothing.
export function createJobQueue(
  mode: JobQueueMode,
  secret: LocalDispatchSecret,
  httpAdapterHost: HttpAdapterHost,
): JobQueue {
  switch (mode) {
    case 'none':
      return new NoopJobQueue();
    case 'local':
      return new LocalJobQueue(secret, httpAdapterHost);
    case 'cloud-tasks':
      throw new Error(
        'JOB_QUEUE=cloud-tasks is not implemented yet; the Cloud Tasks queue arrives with the deployment cycle',
      );
  }
}
