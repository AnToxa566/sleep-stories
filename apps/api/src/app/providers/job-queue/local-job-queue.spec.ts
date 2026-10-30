import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { createJobQueue } from './job-queue.factory';
import { NoopJobQueue } from './job-queue';
import { LocalDispatchSecret } from './local-dispatch-secret';
import { LocalJobQueue } from './local-job-queue';
import type { FetchFunction } from './local-job-queue';

const JOB_ID = '0b9f1c2e-4a6d-4f3b-8c1a-2d5e7f9a1b3c';
const PORT = 41234;

const hostWith = (address: unknown): HttpAdapterHost =>
  ({
    httpAdapter: { getHttpServer: () => ({ address: () => address }) },
  }) as unknown as HttpAdapterHost;

const listening = hostWith({ address: '::', family: 'IPv6', port: PORT });

interface Call {
  url: string;
  init: RequestInit;
}

// A fake fetch that answers with the given statuses in order (a number) or rejects (an
// Error). Records every call.
function fakeFetch(...answers: (number | Error)[]): { fn: FetchFunction; calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchFunction = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[calls.length - 1] ?? 200;
    if (answer instanceof Error) {
      throw answer;
    }
    return new Response(null, { status: answer });
  };
  return { fn, calls };
}

let logged: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  logged = [];
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Lets the promise chain of a post settle without moving the fake clock.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

function queueWith(secret: LocalDispatchSecret, fn: FetchFunction, host = listening) {
  return new LocalJobQueue(secret, host, { fetchFunction: fn });
}

describe('LocalJobQueue', () => {
  it('posts once to the running server with the secret and the job id', async () => {
    const secret = new LocalDispatchSecret();
    const { fn, calls } = fakeFetch(200);
    await queueWith(secret, fn).enqueue(JOB_ID);
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`http://127.0.0.1:${PORT}/api/internal/jobs/run`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      authorization: `Bearer ${secret.value}`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ jobId: JOB_ID });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves before the job finishes (it does not wait for the response)', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let called = 0;
    const fn: FetchFunction = () => {
      called += 1;
      return pending;
    };
    await queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID);
    // enqueue has returned although the fake fetch has not answered.
    expect(called).toBe(1);
    release(new Response(null, { status: 200 }));
    await settle();
  });

  it('retries a 503 after 5 s and again after 15 s, and stops after 3 posts', async () => {
    const { fn, calls } = fakeFetch(503, 503, 503, 503);
    await queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID);
    await settle();
    expect(calls).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(14_999);
    expect(calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);

    // A third 503 does not start a fourth post, however long we wait.
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(3);
  });

  it('stops retrying once a retry succeeds', async () => {
    const { fn, calls } = fakeFetch(503, 200);
    await queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID);
    await settle();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });

  it.each([200, 401, 500])('does not retry a %i', async (status) => {
    const { fn, calls } = fakeFetch(status);
    await queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID);
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a network error and does not throw', async () => {
    const { fn, calls } = fakeFetch(new Error('connect ECONNREFUSED 127.0.0.1:41234'));
    await expect(queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID)).resolves.toBeUndefined();
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it('never puts the secret, the job id, the URL or an error text into a log', async () => {
    const secret = new LocalDispatchSecret();
    const { fn } = fakeFetch(new Error(`boom ${secret.value} ${JOB_ID} 127.0.0.1:${PORT}`));
    await queueWith(secret, fn).enqueue(JOB_ID);
    await settle();

    expect(logged.length).toBeGreaterThan(0);
    const everything = logged.join('\n');
    expect(everything).not.toContain(secret.value);
    expect(everything).not.toContain(JOB_ID);
    expect(everything).not.toContain('127.0.0.1');
    expect(everything).not.toContain('boom');
  });

  it('swallows a fetch function that throws synchronously', async () => {
    const fn: FetchFunction = () => {
      throw new Error('sync');
    };
    await expect(queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID)).resolves.toBeUndefined();
    await settle();
  });

  it.each([
    ['no address (not listening)', hostWith(null)],
    ['a pipe address', hostWith('/tmp/socket')],
    ['no http adapter', { httpAdapter: undefined } as unknown as HttpAdapterHost],
  ])('gives up with one fixed log line when there is %s', async (_name, host) => {
    const { fn, calls } = fakeFetch(200);
    await expect(queueWith(new LocalDispatchSecret(), fn, host).enqueue(JOB_ID)).resolves.toBeUndefined();
    await settle();
    expect(calls).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(JOB_ID);
  });

  it('keeps no pending timer alive (timers are unref-ed)', async () => {
    const unref = jest.fn();
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      handler: () => void,
      ms?: number,
    ) => {
      const timer = realSetTimeout(handler, ms);
      const original = timer.unref.bind(timer);
      timer.unref = () => {
        unref();
        return original();
      };
      return timer;
    }) as unknown as typeof setTimeout);
    const { fn } = fakeFetch(503);
    await queueWith(new LocalDispatchSecret(), fn).enqueue(JOB_ID);
    await settle();
    expect(unref).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('createJobQueue', () => {
  const secret = new LocalDispatchSecret();

  it('none gives the no-op queue', () => {
    expect(createJobQueue('none', secret, listening)).toBeInstanceOf(NoopJobQueue);
  });

  it('local gives the local queue', () => {
    expect(createJobQueue('local', secret, listening)).toBeInstanceOf(LocalJobQueue);
  });

  it('cloud-tasks refuses to boot with a fixed message', () => {
    expect(() => createJobQueue('cloud-tasks', secret, listening)).toThrow(
      'JOB_QUEUE=cloud-tasks is not implemented yet; the Cloud Tasks queue arrives with the deployment cycle',
    );
  });
});
