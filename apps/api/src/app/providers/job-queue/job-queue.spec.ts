import type { HttpAdapterHost } from '@nestjs/core';
import { CloudTasksJobQueue } from './cloud-tasks-job-queue';
import { NoopJobQueue } from './job-queue';
import { createJobQueue } from './job-queue.factory';
import type { JobQueueSettings } from './job-queue.factory';
import { LocalDispatchSecret } from './local-dispatch-secret';
import { LocalJobQueue } from './local-job-queue';

describe('NoopJobQueue', () => {
  it('resolves with undefined and does nothing', async () => {
    await expect(
      new NoopJobQueue().enqueue('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });
});

describe('createJobQueue', () => {
  const secret = new LocalDispatchSecret();
  const host = { httpAdapter: undefined } as unknown as HttpAdapterHost;
  const CLOUD_TASKS: JobQueueSettings = {
    JOB_QUEUE: 'cloud-tasks',
    INTERNAL_OIDC_AUDIENCE: 'https://api-abc123-ew.a.run.app',
    INTERNAL_OIDC_SERVICE_ACCOUNT: 'tasks@project-x.iam.gserviceaccount.com',
    GCP_PROJECT_ID: 'sleep-stories-513914',
    CLOUD_TASKS_LOCATION: 'europe-west1',
    CLOUD_TASKS_QUEUE: 'generation-jobs',
  };

  it('none gives the no-op queue', () => {
    expect(createJobQueue({ JOB_QUEUE: 'none' }, secret, host)).toBeInstanceOf(NoopJobQueue);
  });

  it('local gives the local queue', () => {
    expect(createJobQueue({ JOB_QUEUE: 'local' }, secret, host)).toBeInstanceOf(LocalJobQueue);
  });

  it('cloud-tasks gives the Cloud Tasks queue without calling Google', () => {
    expect(createJobQueue(CLOUD_TASKS, secret, host)).toBeInstanceOf(CloudTasksJobQueue);
  });

  it.each([
    'INTERNAL_OIDC_AUDIENCE',
    'INTERNAL_OIDC_SERVICE_ACCOUNT',
    'GCP_PROJECT_ID',
    'CLOUD_TASKS_LOCATION',
    'CLOUD_TASKS_QUEUE',
  ] as const)('cloud-tasks without %s refuses to boot with a fixed message', (name) => {
    expect(() => createJobQueue({ ...CLOUD_TASKS, [name]: undefined }, secret, host)).toThrow(
      'JOB_QUEUE=cloud-tasks needs the OIDC settings and the Cloud Tasks queue address',
    );
  });
});
