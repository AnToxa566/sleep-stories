import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, RunJobResponseSchema } from '@sleep-stories/contracts';
import type { GenerationJobPayload, JobKind } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { assertInternalRoutesAreGuarded } from '../../test-support/internal-routes';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../auth/access-token-verifier';
import { AppModule } from '../app.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../providers/job-queue/job-queue';
import { LlmProviderError } from '../providers/llm/llm.provider';
import { QueueTopUpService } from '../queue/queue-top-up.service';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';
import { JOB_HANDLERS } from './job-handler';
import type { JobContext, JobHandler } from './job-handler';

// The real AppModule against the REAL local database, listening on a random port, with
// fake job handlers (no provider is ever called; the provider keys are fakes from the
// integration setup). The mode is JOB_QUEUE as the application reads it. AppModule validates
// the environment once, when the file is first imported (ConfigModule.forRoot runs in the
// @Module decorator), so setting process.env before compile() would change nothing. Each
// instance therefore gets a ConfigService that answers JOB_QUEUE with its own mode and
// everything else as the real one does; the factory, the guard and the verifier read it
// through that service exactly as in production.
// Instances:
//   local     JOB_QUEUE=local, the real LocalJobQueue: jobs are dispatched over real HTTP.
//   none      JOB_QUEUE=none: the same secret value must be refused everywhere.
//   recording JOB_QUEUE=local with a recording queue: the sweep is observed, nothing runs.
assertLocalDatabase();

const KID = 'int-test-key';
const KINDS: JobKind[] = ['write_story', 'render_audio', 'suggest_topics'];
const RUN = '/api/internal/jobs/run';
const SWEEP = '/api/internal/jobs/sweep';

interface Instance {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
}

let local: Instance;
let none: Instance;
let recording: Instance;
let data: QueueTestData;
let userKey: CryptoKey;
let issuer: string;
const meUserIds: string[] = [];
const recorded: string[] = [];
let baseConfig: ConfigService<Env, true>;

type Behaviour = (context: JobContext) => Promise<void>;
let behaviour: Behaviour | null = null;
let calls: { kind: JobKind; attempt: number }[] = [];

// The default behaviour: write nothing and mark the job succeeded in its own transaction.
const succeed = (instance: () => Instance): Behaviour => async (context) => {
  await instance().prisma.$transaction(async (tx) => {
    await context.markSucceeded(tx);
  });
};

const handlers: JobHandler[] = KINDS.map((kind) => ({
  kind,
  run: async (context) => {
    calls.push({ kind, attempt: context.job.attempt });
    await (behaviour ?? succeed(() => local))(context);
  },
}));

async function createInstance(mode: 'local' | 'none', queue?: JobQueue): Promise<Instance> {
  const config = new Proxy(baseConfig, {
    get: (target, property) =>
      property === 'get'
        ? (key: string, ...rest: unknown[]) =>
            key === 'JOB_QUEUE'
              ? mode
              : (target.get as (...args: unknown[]) => unknown)(key, ...rest)
        : Reflect.get(target, property),
  });
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(JOB_HANDLERS)
    .useValue(handlers)
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => {
        issuer = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    });
  if (queue !== undefined) {
    builder = builder.overrideProvider(JobQueue).useValue(queue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api'); // main.ts does this; the test app has to as well
  app.useLogger(false);
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), prisma: app.get(PrismaService) };
}

let jwks: ReturnType<typeof createLocalJWKSet>;

async function userToken(userId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(userKey);
}

interface Result {
  status: number;
  json: unknown;
}

async function post(
  instance: Instance,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Result> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${instance.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(100);
  }
  return false;
}

function expectError(result: Result, statusCode: number, code: string) {
  expect(result.status).toBe(statusCode);
  expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({ statusCode, code });
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  userKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }],
  });
  // The real ConfigService, to wrap. The probe is never initialised, so it connects to nothing.
  const probe = await Test.createTestingModule({ imports: [AppModule] }).compile();
  baseConfig = probe.get(ConfigService);
  await probe.close();
  local = await createInstance('local');
  none = await createInstance('none');
  recording = await createInstance('local', {
    enqueue: async (id: string) => {
      recorded.push(id);
    },
  });
  data = new QueueTestData(local.prisma);
});

afterAll(async () => {
  if (data !== undefined) {
    await data.cleanup();
    await local.prisma.user.deleteMany({ where: { id: { in: meUserIds } } });
  }
  await Promise.all([local?.app.close(), none?.app.close(), recording?.app.close()]);
});

beforeEach(() => {
  behaviour = null;
  calls = [];
  recorded.length = 0;
});

const secretOf = (instance: Instance) => instance.app.get(LocalDispatchSecret).value;
const readJob = (id: string) =>
  local.prisma.generationJob.findUniqueOrThrow({ where: { id } });

// A person with a voice and a story, and a pending render_audio job for that story.
async function renderJob(options: { attempts?: number } = {}) {
  const voiceId = await data.voice();
  const userId = await data.user({ voiceId });
  const { storyId } = await data.topic({ story: true });
  const payload: GenerationJobPayload = {
    kind: 'render_audio',
    storyId: storyId as string,
    voiceId,
  };
  const jobId = await data.job({
    userId,
    kind: 'render_audio',
    status: 'pending',
    payload,
    attempts: options.attempts,
  });
  return { jobId, userId };
}

describe('dispatch by the local queue', () => {
  it('runs a job made by the top-up over real HTTP and ends it succeeded', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const userId = await data.user({ voiceId, interestIds: [interestId] });
    // A story without audio in the person's voice: the top-up queues it (creating no render)
    // and asks for a suggestion for the rest, so one job is created and dispatched.
    await data.topic({ interestId, story: true });

    const result = await local.app.get(QueueTopUpService).run(userId);
    expect(result.skipped).toBeUndefined();

    const settled = await waitFor(async () => {
      const jobs = await local.prisma.generationJob.findMany({
        where: { requestedByUserId: userId },
        select: { status: true },
      });
      return jobs.length >= 1 && jobs.every((job) => job.status === 'succeeded');
    });
    expect(settled).toBe(true);

    const jobs = await local.prisma.generationJob.findMany({ where: { requestedByUserId: userId } });
    expect(jobs.map((job) => job.kind)).toEqual(['suggest_topics']);
    expect(jobs.every((job) => job.attempts === 1 && job.lastError === null)).toBe(true);
    expect(calls.map((call) => call.kind)).toEqual(['suggest_topics']);
  });
});

describe('who may call /api/internal/jobs/run', () => {
  it('refuses no token, a wrong secret and a user token with 401 and leaves the job alone', async () => {
    const { jobId } = await renderJob();
    const stranger = randomUUID();
    meUserIds.push(stranger);
    const userJwt = await userToken(stranger);

    // Control: this user token is good for the user routes of the same instance.
    const me = await fetch(`${local.baseUrl}/api/me`, { headers: { authorization: `Bearer ${userJwt}` } });
    expect(me.status).toBe(200);

    const body = { jobId };
    expectError(await post(local, RUN, { body }), 401, 'unauthorized');
    expectError(await post(local, RUN, { token: 'not-the-secret', body }), 401, 'unauthorized');
    expectError(await post(local, RUN, { token: `${secretOf(local)}x`, body }), 401, 'unauthorized');
    expectError(await post(local, RUN, { token: userJwt, body }), 401, 'unauthorized');

    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
    expect(calls).toHaveLength(0);
  });

  it('refuses a body with anything but jobId, even with the secret', async () => {
    const { jobId } = await renderJob();
    const token = secretOf(local);
    for (const body of [
      { jobId, payload: { kind: 'render_audio' } },
      { jobId: 'not-a-uuid' },
      {},
    ]) {
      expectError(await post(local, RUN, { token, body }), 400, 'validation_failed');
    }
    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('does not accept the secret of another instance, nor its own value in a non-local mode', async () => {
    const { jobId } = await renderJob();
    const secret = secretOf(local);
    expect(secretOf(none)).not.toBe(secret);

    // The `none` instance has no OIDC configured here: the same secret value is refused
    // on the run and on the sweep endpoint, and its own secret is refused as well.
    expectError(await post(none, RUN, { token: secret, body: { jobId } }), 401, 'unauthorized');
    expectError(await post(none, SWEEP, { token: secret }), 401, 'unauthorized');
    expectError(await post(none, RUN, { token: secretOf(none), body: { jobId } }), 401, 'unauthorized');
    expectError(await post(none, SWEEP, { token: secretOf(none) }), 401, 'unauthorized');

    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('the outcome of a run as HTTP', () => {
  it('answers 200 { status } for a success', async () => {
    const { jobId } = await renderJob();
    const result = await post(local, RUN, { token: secretOf(local), body: { jobId } });
    expect(result.status).toBe(200);
    expect(RunJobResponseSchema.parse(result.json)).toEqual({ status: 'succeeded' });
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 1 });

    // A second delivery of a finished job is answered 200 and does nothing.
    const again = await post(local, RUN, { token: secretOf(local), body: { jobId } });
    expect(again.status).toBe(200);
    expect(RunJobResponseSchema.parse(again.json)).toEqual({ status: 'finished' });
    expect(calls).toHaveLength(1);
  });

  it('answers 503 for a retryable error, releases the job and succeeds on the next delivery', async () => {
    const { jobId } = await renderJob();
    let failuresLeft = 1;
    behaviour = async (context) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new LlmProviderError(true, 529);
      }
      await succeed(() => local)(context);
    };
    const token = secretOf(local);

    const first = await post(local, RUN, { token, body: { jobId } });
    expect(first.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(first.json)).toEqual({
      statusCode: 503,
      code: 'job_retry',
      message: 'Try again later',
    });
    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 1, startedAt: null });

    const second = await post(local, RUN, { token, body: { jobId } });
    expect(second.status).toBe(200);
    expect(RunJobResponseSchema.parse(second.json)).toEqual({ status: 'succeeded' });
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('answers 503 for a job that another run holds', async () => {
    const { userId } = await renderJob();
    const running = await data.job({
      userId,
      kind: 'suggest_topics',
      status: 'running',
      payload: { kind: 'suggest_topics', missing: 1 },
      attempts: 1,
    });
    const result = await post(local, RUN, { token: secretOf(local), body: { jobId: running } });
    expectError(result, 503, 'job_retry');
    expect(await readJob(running)).toMatchObject({ status: 'running', attempts: 1 });
  });

  it('ends failed with a code-only last_error once the attempts run out, and answers 200', async () => {
    const { jobId } = await renderJob();
    behaviour = async () => {
      throw new LlmProviderError(true, 529);
    };
    const token = secretOf(local);

    // render_audio has 2 attempts: the first is retried, the second is final.
    expect((await post(local, RUN, { token, body: { jobId } })).status).toBe(503);
    const last = await post(local, RUN, { token, body: { jobId } });
    expect(last.status).toBe(200);
    expect(RunJobResponseSchema.parse(last.json)).toEqual({ status: 'failed' });

    const job = await readJob(jobId);
    expect(job).toMatchObject({ status: 'failed', attempts: 2, lastError: 'llm_error:529' });
    expect(JSON.stringify(last.json)).not.toContain('LLM request failed');
    expect(calls).toHaveLength(2);
  });
});

describe('route enumeration', () => {
  it('finds exactly the two real internal routes and both are guarded', () => {
    for (const instance of [local, none, recording]) {
      const routes = assertInternalRoutesAreGuarded(instance.app);
      expect(routes.map((route) => route.path).sort()).toEqual([
        'internal/jobs/run',
        'internal/jobs/sweep',
      ]);
      expect(routes.every((route) => route.isInternal)).toBe(true);
    }
  });
});

describe('POST /api/internal/jobs/sweep', () => {
  it('hands a stale pending job back to the queue with the secret, and changes nothing itself', async () => {
    const stale = await renderJob();
    const fresh = await renderJob();
    // Far older than any leftover row of the development database, so it is among the
    // (at most 50, oldest first) rows the sweep returns.
    await local.prisma.$executeRaw`
      UPDATE generation_jobs SET created_at = now() - make_interval(days => 3650)
      WHERE id = ${stale.jobId}::uuid`;

    const result = await post(recording, SWEEP, { token: secretOf(recording) });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ enqueued: recorded.length });
    expect(recorded).toContain(stale.jobId);
    expect(recorded).not.toContain(fresh.jobId);
    expect(await readJob(stale.jobId)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('refuses a user token, a wrong secret and no token with 401 and enqueues nothing', async () => {
    const stale = await renderJob();
    await local.prisma.$executeRaw`
      UPDATE generation_jobs SET created_at = now() - make_interval(days => 3650)
      WHERE id = ${stale.jobId}::uuid`;
    const stranger = randomUUID();
    meUserIds.push(stranger);
    const userJwt = await userToken(stranger);

    expectError(await post(recording, SWEEP, { token: userJwt }), 401, 'unauthorized');
    expectError(await post(recording, SWEEP, { token: 'wrong' }), 401, 'unauthorized');
    expectError(await post(recording, SWEEP), 401, 'unauthorized');
    expect(recorded).toHaveLength(0);
  });
});
