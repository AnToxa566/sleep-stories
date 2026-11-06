import type { HttpAdapterHost } from '@nestjs/core';
import type { Env } from '../../config/env';
import { createCloudTasksJobQueue } from './cloud-tasks-job-queue';
import { JobQueue, NoopJobQueue } from './job-queue';
import type { LocalDispatchSecret } from './local-dispatch-secret';
import { LocalJobQueue } from './local-job-queue';

// Chooses the JobQueue by JOB_QUEUE. env.ts already refuses `none` and `local` in
// production and on Cloud Run, so a production boot cannot get a queue that loses or
// self-posts jobs. `cloud-tasks` needs the OIDC pair and the queue address; env.ts requires
// them with that mode, and a missing one here is a bug, so it throws at boot. Building the
// adapter calls no Google service (the client is created at the first enqueue).
export type JobQueueSettings = Pick<
  Env,
  | 'JOB_QUEUE'
  | 'INTERNAL_OIDC_AUDIENCE'
  | 'INTERNAL_OIDC_SERVICE_ACCOUNT'
  | 'GCP_PROJECT_ID'
  | 'CLOUD_TASKS_LOCATION'
  | 'CLOUD_TASKS_QUEUE'
>;

export function createJobQueue(
  settings: JobQueueSettings,
  secret: LocalDispatchSecret,
  httpAdapterHost: HttpAdapterHost,
): JobQueue {
  switch (settings.JOB_QUEUE) {
    case 'none':
      return new NoopJobQueue();
    case 'local':
      return new LocalJobQueue(secret, httpAdapterHost);
    case 'cloud-tasks': {
      const audience = settings.INTERNAL_OIDC_AUDIENCE;
      const serviceAccountEmail = settings.INTERNAL_OIDC_SERVICE_ACCOUNT;
      const projectId = settings.GCP_PROJECT_ID;
      const location = settings.CLOUD_TASKS_LOCATION;
      const queue = settings.CLOUD_TASKS_QUEUE;
      if (
        audience === undefined ||
        serviceAccountEmail === undefined ||
        projectId === undefined ||
        location === undefined ||
        queue === undefined
      ) {
        throw new Error('JOB_QUEUE=cloud-tasks needs the OIDC settings and the Cloud Tasks queue address');
      }
      return createCloudTasksJobQueue({ audience, serviceAccountEmail, projectId, location, queue });
    }
  }
}
