import { Logger } from '@nestjs/common';
import { JOB_LEASE_MINUTES } from '../../queue/queue-policy';
import { CloudTasksJobQueue, queuePathOf, RUN_JOB_PATH } from './cloud-tasks-job-queue';
import type { CloudTasksClientLike } from './cloud-tasks-job-queue';

const JOB_ID = '0b9f1c2e-4a6d-4f3b-8c1a-2d5e7f9a1b3c';
const AUDIENCE = 'https://api-abc123-ew.a.run.app';
const SERVICE_ACCOUNT = 'tasks@project-x.iam.gserviceaccount.com';
const QUEUE_PATH = 'projects/sleep-stories-513914/locations/europe-west1/queues/generation-jobs';

type CreateTask = jest.MockedFunction<CloudTasksClientLike['createTask']>;

function queueWith(createTask: CreateTask, audience = AUDIENCE) {
  return new CloudTasksJobQueue({ createTask }, QUEUE_PATH, {
    audience,
    serviceAccountEmail: SERVICE_ACCOUNT,
  });
}

describe('CloudTasksJobQueue', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('creates one task with exactly the request the run endpoint expects', async () => {
    const createTask: CreateTask = jest.fn().mockResolvedValue([{}]);
    await queueWith(createTask).enqueue(JOB_ID);

    expect(createTask).toHaveBeenCalledTimes(1);
    const [request, options] = createTask.mock.calls[0];
    expect(request).toEqual({
      parent: QUEUE_PATH,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${AUDIENCE}/api/internal/jobs/run`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from('{"jobId":"' + JOB_ID + '"}'),
          oidcToken: { serviceAccountEmail: SERVICE_ACCOUNT, audience: AUDIENCE },
        },
        dispatchDeadline: { seconds: 660 },
      },
    });
    // No `name`: an unnamed task can be created again for the same job by the sweep.
    expect(request.task).not.toHaveProperty('name');
    // The body carries the job id and nothing else.
    expect(JSON.parse(Buffer.from(request.task?.httpRequest?.body as Buffer).toString('utf8'))).toEqual({
      jobId: JOB_ID,
    });
    // No automatic SDK retries and an explicit client-side timeout.
    expect(options).toEqual({ timeout: 10_000, retry: null });
    expect(RUN_JOB_PATH).toBe('/api/internal/jobs/run');
  });

  it('follows the job lease: dispatch deadline is the lease plus one minute', async () => {
    const createTask: CreateTask = jest.fn().mockResolvedValue([{}]);
    await queueWith(createTask).enqueue(JOB_ID);
    expect(createTask.mock.calls[0][0].task?.dispatchDeadline).toEqual({
      seconds: (JOB_LEASE_MINUTES + 1) * 60,
    });
  });

  it.each([
    ['a trailing slash', `${AUDIENCE}/`],
    ['a path', `${AUDIENCE}/some/path`],
    ['a path with a trailing slash', `${AUDIENCE}/some/path/`],
  ])('with %s in the audience: the target uses the origin, the token keeps the exact audience', async (_name, audience) => {
    const createTask: CreateTask = jest.fn().mockResolvedValue([{}]);
    await queueWith(createTask, audience).enqueue(JOB_ID);
    const httpRequest = createTask.mock.calls[0][0].task?.httpRequest;
    expect(httpRequest?.url).toBe(`${AUDIENCE}/api/internal/jobs/run`);
    expect(httpRequest?.oidcToken?.audience).toBe(audience);
  });

  it('keeps a non-default port of the audience in the target', async () => {
    const createTask: CreateTask = jest.fn().mockResolvedValue([{}]);
    await queueWith(createTask, 'https://api.example.test:8443').enqueue(JOB_ID);
    expect(createTask.mock.calls[0][0].task?.httpRequest?.url).toBe(
      'https://api.example.test:8443/api/internal/jobs/run',
    );
  });

  it('resolves when the client rejects, and logs one fixed line without the job id or the error text', async () => {
    const createTask: CreateTask = jest
      .fn()
      .mockRejectedValue(new Error(`secret-detail ${JOB_ID} ${QUEUE_PATH} ${AUDIENCE}`));
    await expect(queueWith(createTask).enqueue(JOB_ID)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Cloud Tasks queue: the job was not enqueued');
  });

  it('adds the numeric status code to the line and nothing else of the error', async () => {
    const error = Object.assign(new Error(`secret-detail ${JOB_ID}`), { code: 14, details: 'secret-detail' });
    const createTask: CreateTask = jest.fn().mockRejectedValue(error);
    await expect(queueWith(createTask).enqueue(JOB_ID)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Cloud Tasks queue: the job was not enqueued (code 14)');
  });

  it.each([
    ['a string code', { code: 'secret-detail' }],
    ['a non-integer code', { code: 1.5 }],
    ['an out-of-range code', { code: 123456 }],
    ['a thrown string', 'secret-detail'],
    ['null', null],
  ])('ignores %s in the error when logging', async (_name, thrown) => {
    const createTask: CreateTask = jest.fn().mockRejectedValue(thrown);
    await expect(queueWith(createTask).enqueue(JOB_ID)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Cloud Tasks queue: the job was not enqueued');
  });

  it('resolves when the client throws synchronously', async () => {
    const createTask: CreateTask = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(queueWith(createTask).enqueue(JOB_ID)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('queuePathOf', () => {
  it('has the format of CloudTasksClient.queuePath', async () => {
    const { CloudTasksClient } = await import('@google-cloud/tasks');
    // Constructing the client does no network I/O.
    const client = new CloudTasksClient({ fallback: 'rest' });
    expect(queuePathOf({ projectId: 'sleep-stories-513914', location: 'europe-west1', queue: 'generation-jobs' })).toBe(
      client.queuePath('sleep-stories-513914', 'europe-west1', 'generation-jobs'),
    );
    await client.close();
  });
});
