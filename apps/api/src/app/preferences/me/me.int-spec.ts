import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, MeResponseSchema, QueueResponseSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../../platform/auth/access-token/access-token-verifier';
import { AppModule } from '../../app.module';
import type { Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { JobQueue } from '../../providers/job-queue/job-queue';
import { StorageService } from '../../providers/storage/storage.service';
import { QueueTopUpService } from '../../queue/top-up/queue-top-up.service';
import { assertLocalDatabase } from '../../../test-support/assert-local-database';
import { QueueTestData } from '../../../test-support/queue-test-data';

// Runs against the REAL local database with the real AppModule: the real guard,
// validation pipe, services and Prisma. Only the key source of the access-token
// verifier is replaced (a locally generated ES256 key pair instead of the Auth
// server's JWKS); the production verifier class is used unchanged.
// Every test uses fresh random users, and afterAll deletes them (the cascade
// removes their rows).
assertLocalDatabase();

const KID = 'int-test-key';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
let issuer: string;
let signingKey: CryptoKey;
const createdUserIds: string[] = [];
let usersBefore: number;
// Test voices, stories and queue items (with their own people) for the settings tests.
let data: QueueTestData;

const topUpRun = jest.fn(async () => undefined);

// A recording fake: the real queue (JOB_QUEUE=local) would run a job with the paid providers.
class RecordingQueue extends JobQueue {
  enqueued: string[] = [];
  async enqueue(jobId: string): Promise<void> {
    this.enqueued.push(jobId);
  }
}
const jobQueue = new RecordingQueue();

function newUserId(): string {
  const id = randomUUID();
  createdUserIds.push(id);
  return id;
}

async function tokenFor(userId: string, key: CryptoKey = signingKey): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}

interface Result {
  status: number;
  text: string;
  json: unknown;
}

async function call(
  method: 'GET' | 'PUT',
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Result> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
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
  return { status: response.status, text, json };
}

const getMe = async (userId: string) => call('GET', '/me', { token: await tokenFor(userId) });
const putOnboarding = async (userId: string, body: unknown) =>
  call('PUT', '/me/onboarding', { token: await tokenFor(userId), body });
const putVoice = async (userId: string, body: unknown) =>
  call('PUT', '/me/voice', { token: await tokenFor(userId), body });
const putInterests = async (userId: string, body: unknown) =>
  call('PUT', '/me/interests', { token: await tokenFor(userId), body });

const BODY_A = { voiceSlug: 'anna', styles: ['history', 'facts'], interestSlugs: ['space', 'history', 'ocean'] };
const BODY_B = { voiceSlug: 'lev', styles: ['fairy_tale'], interestSlugs: ['art', 'music'] };

// The body as it must read back: styles in canonical order, interests by sort order.
const EXPECTED_A = {
  onboardingCompleted: true,
  preferences: { voiceSlug: 'anna', styles: ['facts', 'history'], interestSlugs: ['history', 'space', 'ocean'], customInterests: [] },
};
const EXPECTED_B = {
  onboardingCompleted: true,
  preferences: { voiceSlug: 'lev', styles: ['fairy_tale'], interestSlugs: ['music', 'art'], customInterests: [] },
};

async function rowCounts(userId: string) {
  const [users, preferences, interests, customInterests] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.userPreference.count({ where: { userId } }),
    prisma.userInterest.count({ where: { userId } }),
    prisma.userCustomInterest.count({ where: { userId } }),
  ]);
  return { users, preferences, interests, customInterests };
}

function expectError(result: Result, statusCode: number, code: string) {
  expect(result.status).toBe(statusCode);
  expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({ statusCode, code });
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }] });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => {
        issuer = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    })
    // Onboarding starts the queue top-up; these tests are about the answers, so the top-up
    // is a no-op and no job rows are created. The trigger itself is proved in
    // internal/generation-e2e.int-spec.ts.
    .overrideProvider(QueueTopUpService)
    .useValue({ run: topUpRun })
    // GET /queue signs the audio of ready items; the narrator tests read it.
    .overrideProvider(StorageService)
    .useValue({ signMany: async (paths: readonly string[]) => paths.map((_p, i) => `https://signed.example.test/opaque-${i}`) })
    .overrideProvider(JobQueue)
    .useValue(jobQueue)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api'); // main.ts does this; the test app has to as well
  app.useLogger(false);
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
  data = new QueueTestData(prisma);
  usersBefore = await prisma.user.count();
});

afterEach(async () => {
  // Tests that deactivate reference data restore it even when they fail.
  await prisma.voice.updateMany({ where: { slug: 'anna' }, data: { isActive: true } });
  await prisma.interest.updateMany({ where: { slug: 'space' }, data: { isActive: true } });
});

afterAll(async () => {
  if (prisma) {
    await data.cleanup();
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    // Nothing of ours is left, and the table is back to its size before the suite.
    expect(await prisma.user.count({ where: { id: { in: createdUserIds } } })).toBe(0);
    expect(await prisma.user.count()).toBe(usersBefore);
  }
  await app?.close();
});

describe('authentication', () => {
  it('rejects a request without a token with 401 and the error schema body', async () => {
    expectError(await call('GET', '/me'), 401, 'unauthorized');
    expectError(await call('PUT', '/me/onboarding', { body: BODY_A }), 401, 'unauthorized');
  });

  it('rejects a token signed by another key with 401 and creates no user', async () => {
    const other = await generateKeyPair('ES256');
    const userId = newUserId();
    expectError(await call('GET', '/me', { token: await tokenFor(userId, other.privateKey) }), 401, 'unauthorized');
    expect((await rowCounts(userId)).users).toBe(0);
  });

  it('keeps the hello route public', async () => {
    const result = await call('GET', '');
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ message: 'Hello API' });
  });
});

describe('GET /api/me', () => {
  it('creates the users row on first use and reports onboarding as not completed', async () => {
    const userId = newUserId();
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });
    const result = await getMe(userId);
    expect(result.status).toBe(200);
    expect(MeResponseSchema.parse(result.json)).toEqual({ onboardingCompleted: false, preferences: null });
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 0, interests: 0, customInterests: 0 });
    // A second GET changes nothing.
    await getMe(userId);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 0, interests: 0, customInterests: 0 });
  });

  it('puts no user id or email in the response', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    const result = await getMe(userId);
    expect(result.text).not.toContain(userId);
    expect(result.text).not.toContain('@example.test');
  });
});

describe('PUT /api/me/onboarding', () => {
  it('saves the answers and GET returns the same slugs and styles', async () => {
    const userId = newUserId();
    const put = await putOnboarding(userId, BODY_A);
    expect(put.status).toBe(200);
    expect(MeResponseSchema.parse(put.json)).toEqual(EXPECTED_A);

    const get = await getMe(userId);
    expect(get.status).toBe(200);
    expect(MeResponseSchema.parse(get.json)).toEqual(EXPECTED_A);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
  });

  it('is idempotent: an identical PUT repeated gives 200 and the same rows', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    const interestsBefore = await prisma.userInterest.findMany({ where: { userId }, orderBy: { interestId: 'asc' } });
    const preferenceBefore = await prisma.userPreference.findUniqueOrThrow({ where: { userId } });

    const again = await putOnboarding(userId, BODY_A);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(EXPECTED_A);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
    const interestsAfter = await prisma.userInterest.findMany({ where: { userId }, orderBy: { interestId: 'asc' } });
    expect(interestsAfter.map((row) => row.interestId)).toEqual(interestsBefore.map((row) => row.interestId));
    const preferenceAfter = await prisma.userPreference.findUniqueOrThrow({ where: { userId } });
    expect({ voiceId: preferenceAfter.voiceId, styles: preferenceAfter.styles }).toEqual({
      voiceId: preferenceBefore.voiceId,
      styles: preferenceBefore.styles,
    });
  });

  it('replaces the interest set when it changes: the old interests are gone', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    const changed = { voiceSlug: 'kate', styles: ['history'], interestSlugs: ['ocean', 'music'] };
    const result = await putOnboarding(userId, changed);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      onboardingCompleted: true,
      preferences: { voiceSlug: 'kate', styles: ['history'], interestSlugs: ['music', 'ocean'], customInterests: [] },
    });
    const slugs = (await prisma.userInterest.findMany({ where: { userId }, include: { interest: true } })).map(
      (row) => row.interest.slug,
    );
    expect(slugs.sort()).toEqual(['music', 'ocean']);
    expect((await getMe(userId)).json).toEqual(result.json);
  });

  it('survives two concurrent identical PUTs from a brand-new user', async () => {
    const userId = newUserId();
    const token = await tokenFor(userId);
    const [first, second] = await Promise.all([
      call('PUT', '/me/onboarding', { token, body: BODY_A }),
      call('PUT', '/me/onboarding', { token, body: BODY_A }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.json).toEqual(EXPECTED_A);
    expect(second.json).toEqual(EXPECTED_A);
    expect((await getMe(userId)).json).toEqual(EXPECTED_A);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
  });

  it('serialises concurrent PUTs with different bodies: the final state is exactly one of them', async () => {
    const userId = newUserId();
    const token = await tokenFor(userId);
    const bodyOther = { voiceSlug: 'maxim', styles: ['facts'], interestSlugs: ['nature', 'science'] };
    const expectedOther = {
      onboardingCompleted: true,
      preferences: { voiceSlug: 'maxim', styles: ['facts'], interestSlugs: ['science', 'nature'], customInterests: [] },
    };
    const results = await Promise.all([
      call('PUT', '/me/onboarding', { token, body: BODY_A }),
      call('PUT', '/me/onboarding', { token, body: bodyOther }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const final = (await getMe(userId)).json;
    // Never a mix of the two (for example the voice of one and the interests of the other).
    expect([EXPECTED_A, expectedOther]).toContainEqual(final);
    const count = (final as typeof EXPECTED_A).preferences.interestSlugs.length;
    expect((await rowCounts(userId)).interests).toBe(count);
  });

  it('answers 422 unknown_voice, writes nothing and creates no user row', async () => {
    const userId = newUserId();
    const result = await putOnboarding(userId, { ...BODY_A, voiceSlug: 'no-such-voice' });
    expectError(result, 422, 'unknown_voice');
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });
  });

  it('answers 422 unknown_voice for a deactivated voice', async () => {
    await prisma.voice.update({ where: { slug: 'anna' }, data: { isActive: false } });
    const userId = newUserId();
    expectError(await putOnboarding(userId, BODY_A), 422, 'unknown_voice');
    expect((await rowCounts(userId)).preferences).toBe(0);
  });

  it('answers 422 unknown_interest and writes nothing', async () => {
    const userId = newUserId();
    const result = await putOnboarding(userId, { ...BODY_A, interestSlugs: ['space', 'no-such-interest'] });
    expectError(result, 422, 'unknown_interest');
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });
  });

  it('answers 422 for a deactivated interest', async () => {
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: false } });
    const userId = newUserId();
    expectError(await putOnboarding(userId, BODY_A), 422, 'unknown_interest');
    expect((await rowCounts(userId)).interests).toBe(0);
  });

  it('leaves an onboarded user untouched when a later PUT is refused (rollback)', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    expectError(await putOnboarding(userId, { ...BODY_B, interestSlugs: ['art', 'no-such-interest'] }), 422, 'unknown_interest');
    expectError(await putOnboarding(userId, { ...BODY_B, voiceSlug: 'no-such-voice' }), 422, 'unknown_voice');
    expect((await getMe(userId)).json).toEqual(EXPECTED_A);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
  });

  it.each([
    ['an extra userId key', { ...BODY_A, userId: randomUUID() }],
    ['empty styles', { ...BODY_A, styles: [] }],
    ['empty interests', { ...BODY_A, interestSlugs: [] }],
    ['no interest of any kind', { ...BODY_A, interestSlugs: [], customInterests: [] }],
    ['21 custom interests', { ...BODY_A, customInterests: Array.from({ length: 21 }, (_v, i) => `тема ${i}`) }],
    ['a blank custom interest', { ...BODY_A, customInterests: ['   '] }],
    ['an over-long custom interest', { ...BODY_A, customInterests: ['я'.repeat(61)] }],
    ['a custom interest with a newline', { ...BODY_A, customInterests: ['два\nряда'] }],
    ['duplicate custom interests', { ...BODY_A, customInterests: ['Кофе', ' кофе '] }],
    ['a wrong type', { ...BODY_A, voiceSlug: 42 }],
  ])('answers 400 validation_failed for %s and creates no rows', async (_label, body) => {
    const userId = newUserId();
    expectError(await putOnboarding(userId, body), 400, 'validation_failed');
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });
  });
});

describe('custom interests', () => {
  const customRows = async (userId: string) =>
    (await prisma.userCustomInterest.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(
      (row) => row.title,
    );

  it('saves them trimmed and lowercased, in request order, and GET /me returns them', async () => {
    const userId = newUserId();
    const put = await putOnboarding(userId, { ...BODY_A, customInterests: ['  Старые Поезда ', 'кофе', 'Дождь'] });
    expect(put.status).toBe(200);
    const expected = {
      ...EXPECTED_A,
      preferences: { ...EXPECTED_A.preferences, customInterests: ['старые поезда', 'кофе', 'дождь'] },
    };
    expect(MeResponseSchema.parse(put.json)).toEqual(expected);
    expect((await getMe(userId)).json).toEqual(expected);
    expect(await customRows(userId)).toEqual(['старые поезда', 'кофе', 'дождь']);
  });

  it('replaces the set on a later PUT and clears it when the new request has none', async () => {
    const userId = newUserId();
    await putOnboarding(userId, { ...BODY_A, customInterests: ['кофе', 'дождь'] });
    await putOnboarding(userId, { ...BODY_A, customInterests: ['чай'] });
    expect(await customRows(userId)).toEqual(['чай']);
    await putOnboarding(userId, BODY_A);
    expect(await customRows(userId)).toEqual([]);
    expect((await getMe(userId)).json).toEqual(EXPECTED_A);
  });

  it('is idempotent: an identical PUT repeated leaves the same titles in the same order', async () => {
    const userId = newUserId();
    const body = { ...BODY_A, customInterests: ['кофе', 'дождь', 'чай'] };
    const first = await putOnboarding(userId, body);
    const again = await putOnboarding(userId, body);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await customRows(userId)).toEqual(['кофе', 'дождь', 'чай']);
    expect((await getMe(userId)).json).toEqual(first.json);
  });

  it('accepts custom interests alone, with no catalogue interests', async () => {
    const userId = newUserId();
    const put = await putOnboarding(userId, { ...BODY_A, interestSlugs: [], customInterests: ['кофе'] });
    expect(put.status).toBe(200);
    expect(put.json).toEqual({
      onboardingCompleted: true,
      preferences: { voiceSlug: 'anna', styles: ['facts', 'history'], interestSlugs: [], customInterests: ['кофе'] },
    });
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 0, customInterests: 1 });
  });

  it('accepts exactly 20 custom interests', async () => {
    const userId = newUserId();
    const titles = Array.from({ length: 20 }, (_v, i) => `тема ${i}`);
    expect((await putOnboarding(userId, { ...BODY_A, customInterests: titles })).status).toBe(200);
    expect(await customRows(userId)).toEqual(titles);
  });

  it('refuses a custom title equal to a catalogue title (any case) with 422 and writes nothing', async () => {
    const userId = newUserId();
    await putOnboarding(userId, { ...BODY_A, customInterests: ['кофе'] });
    const result = await putOnboarding(userId, { ...BODY_B, customInterests: ['чай', ' КОСМОС '] });
    expectError(result, 422, 'validation_failed');
    expect(result.text).not.toContain('космос');
    // Rolled back: the earlier state is intact.
    expect(await customRows(userId)).toEqual(['кофе']);
    expect((await getMe(userId)).json).toMatchObject({ preferences: { voiceSlug: 'anna' } });
  });

  it('does not treat the title of an inactive catalogue interest as a duplicate', async () => {
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: false } });
    const userId = newUserId();
    const put = await putOnboarding(userId, { ...BODY_B, customInterests: ['космос'] });
    expect(put.status).toBe(200);
    expect(await customRows(userId)).toEqual(['космос']);
  });

  it("never shows one user's custom interests to another, and a PUT by one leaves the other's alone", async () => {
    const a = newUserId();
    const b = newUserId();
    await putOnboarding(a, { ...BODY_A, customInterests: ['кофе', 'дождь'] });
    expect((await getMe(b)).json).toEqual({ onboardingCompleted: false, preferences: null });
    await putOnboarding(b, { ...BODY_B, customInterests: ['чай'] });
    expect(await customRows(a)).toEqual(['кофе', 'дождь']);
    expect(await customRows(b)).toEqual(['чай']);
    expect((await getMe(a)).json).toMatchObject({ preferences: { customInterests: ['кофе', 'дождь'] } });
    expect((await getMe(b)).json).toMatchObject({ preferences: { customInterests: ['чай'] } });
  });

  it('refuses a body that names a user, even with custom interests', async () => {
    const a = newUserId();
    const b = newUserId();
    await putOnboarding(b, { ...BODY_B, customInterests: ['чай'] });
    expectError(await putOnboarding(a, { ...BODY_A, customInterests: ['кофе'], userId: b }), 400, 'validation_failed');
    expect(await customRows(a)).toEqual([]);
    expect(await customRows(b)).toEqual(['чай']);
  });

  it('leaves the stored set untouched when a later PUT is refused', async () => {
    const userId = newUserId();
    await putOnboarding(userId, { ...BODY_A, customInterests: ['кофе'] });
    expectError(
      await putOnboarding(userId, { ...BODY_B, interestSlugs: ['no-such-interest'], customInterests: ['чай'] }),
      422,
      'unknown_interest',
    );
    expect(await customRows(userId)).toEqual(['кофе']);
  });
});

describe('isolation between users (security rule 2)', () => {
  it("one user's PUT never changes another user's rows, and GET never shows another user's data", async () => {
    const a = newUserId();
    const b = newUserId();
    await putOnboarding(a, BODY_A);
    const aInterestsBefore = (await prisma.userInterest.findMany({ where: { userId: a } })).map((r) => r.interestId).sort();

    // B has not onboarded: A's completed state must not leak into B's GET.
    expect((await getMe(b)).json).toEqual({ onboardingCompleted: false, preferences: null });

    expect((await putOnboarding(b, BODY_B)).json).toEqual(EXPECTED_B);

    expect((await getMe(a)).json).toEqual(EXPECTED_A);
    expect((await getMe(b)).json).toEqual(EXPECTED_B);
    const aInterestsAfter = (await prisma.userInterest.findMany({ where: { userId: a } })).map((r) => r.interestId).sort();
    expect(aInterestsAfter).toEqual(aInterestsBefore);
    expect(await rowCounts(a)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
    expect(await rowCounts(b)).toEqual({ users: 1, preferences: 1, interests: 2, customInterests: 0 });
  });

  it('ignores a user id sent in the X-User-Id header or in query parameters', async () => {
    const a = newUserId();
    const b = newUserId();
    await putOnboarding(b, BODY_B);

    const withHeader = await call('GET', `/me?userId=${b}&user_id=${b}`, {
      token: await tokenFor(a),
      headers: { 'x-user-id': b, 'x-forwarded-user': b },
    });
    expect(withHeader.status).toBe(200);
    expect(withHeader.json).toEqual({ onboardingCompleted: false, preferences: null });

    const putWithHeader = await call('PUT', `/me/onboarding?userId=${b}`, {
      token: await tokenFor(a),
      body: BODY_A,
      headers: { 'x-user-id': b },
    });
    expect(putWithHeader.json).toEqual(EXPECTED_A);
    expect(await rowCounts(a)).toEqual({ users: 1, preferences: 1, interests: 3, customInterests: 0 });
    expect((await getMe(b)).json).toEqual(EXPECTED_B);
  });

  it('refuses a body that names a user, so the body can never pick the user', async () => {
    const a = newUserId();
    const b = newUserId();
    await putOnboarding(b, BODY_B);
    expectError(await putOnboarding(a, { ...BODY_A, userId: b }), 400, 'validation_failed');
    expect((await getMe(b)).json).toEqual(EXPECTED_B);
    expect((await rowCounts(a)).preferences).toBe(0);
  });
});

describe('PUT /api/me/voice', () => {
  // Everything a person's settings consist of, with ids and times, so a rewrite shows too.
  async function storedSettings(userId: string) {
    const [preference, interests, customInterests] = await Promise.all([
      prisma.userPreference.findUniqueOrThrow({ where: { userId }, include: { voice: true } }),
      prisma.userInterest.findMany({ where: { userId }, orderBy: { interestId: 'asc' } }),
      prisma.userCustomInterest.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    ]);
    return {
      voiceSlug: preference.voice.slug,
      voiceId: preference.voiceId,
      styles: preference.styles,
      interests,
      customInterests,
    };
  }
  const withVoice = (voiceSlug: string) => ({
    ...EXPECTED_A,
    preferences: { ...EXPECTED_A.preferences, voiceSlug, customInterests: ['кофе', 'дождь'] },
  });
  const onboarded = async () => {
    const userId = newUserId();
    expect((await putOnboarding(userId, { ...BODY_A, customInterests: ['кофе', 'дождь'] })).status).toBe(200);
    return userId;
  };
  const slugOf = async (voiceId: string) =>
    (await prisma.voice.findUniqueOrThrow({ where: { id: voiceId }, select: { slug: true } })).slug;

  it('changes the voice and nothing else, and GET /me reads it back', async () => {
    const userId = await onboarded();
    const before = await storedSettings(userId);

    const result = await putVoice(userId, { voiceSlug: 'lev' });

    expect(result.status).toBe(200);
    expect(MeResponseSchema.parse(result.json)).toEqual(withVoice('lev'));
    expect((await getMe(userId)).json).toEqual(withVoice('lev'));
    const after = await storedSettings(userId);
    const lev = await prisma.voice.findUniqueOrThrow({ where: { slug: 'lev' } });
    expect(after).toEqual({ ...before, voiceSlug: 'lev', voiceId: lev.id });
  });

  it('accepts the voice the person already has', async () => {
    const userId = await onboarded();
    const before = await storedSettings(userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await putVoice(userId, { voiceSlug: 'anna' });
      expect(result.status).toBe(200);
      expect(result.json).toEqual(withVoice('anna'));
    }
    expect(await storedSettings(userId)).toEqual(before);
  });

  it('answers 401 without a token', async () => {
    expectError(await call('PUT', '/me/voice', { body: { voiceSlug: 'lev' } }), 401, 'unauthorized');
  });

  it('refuses a body that names a user and changes neither person', async () => {
    const a = await onboarded();
    const b = await onboarded();
    expectError(await putVoice(a, { voiceSlug: 'lev', userId: b }), 400, 'validation_failed');
    expect((await getMe(a)).json).toEqual(withVoice('anna'));
    expect((await getMe(b)).json).toEqual(withVoice('anna'));
  });

  it("changes only the caller's voice, whatever a header or the query says", async () => {
    const a = await onboarded();
    const b = await onboarded();
    const before = await storedSettings(b);
    const result = await call('PUT', `/me/voice?userId=${b}`, {
      token: await tokenFor(a),
      body: { voiceSlug: 'lev' },
      headers: { 'x-user-id': b },
    });
    expect(result.status).toBe(200);
    expect((await getMe(a)).json).toEqual(withVoice('lev'));
    expect(await storedSettings(b)).toEqual(before);
  });

  it('answers 422 unknown_voice for an unknown voice and for a deactivated one', async () => {
    const userId = await onboarded();
    expect((await putVoice(userId, { voiceSlug: 'lev' })).status).toBe(200);
    const before = await storedSettings(userId);

    expectError(await putVoice(userId, { voiceSlug: 'no-such-voice' }), 422, 'unknown_voice');
    await prisma.voice.update({ where: { slug: 'anna' }, data: { isActive: false } });
    expectError(await putVoice(userId, { voiceSlug: 'anna' }), 422, 'unknown_voice');

    expect(await storedSettings(userId)).toEqual(before);
  });

  it('answers 400 before onboarding and creates neither a users row nor preferences', async () => {
    const stranger = newUserId();
    expectError(await putVoice(stranger, { voiceSlug: 'lev' }), 400, 'validation_failed');
    expect(await rowCounts(stranger)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });

    const signedInOnly = newUserId();
    await getMe(signedInOnly); // creates the users row
    expectError(await putVoice(signedInOnly, { voiceSlug: 'lev' }), 400, 'validation_failed');
    expect(await rowCounts(signedInOnly)).toEqual({ users: 1, preferences: 0, interests: 0, customInterests: 0 });
  });

  it('creates no job, leaves the queue and its jobs alone and never runs the top-up', async () => {
    const oldVoiceId = await data.voice();
    const newVoiceId = await data.voice();
    const userId = await data.user({ voiceId: oldVoiceId });
    const ready = await data.topic({ story: true, audioVoiceIds: [oldVoiceId] });
    const plain = await data.topic();
    await data.queueItem(userId, ready.topicId, 1);
    await data.queueItem(userId, plain.topicId, 2);
    // A job in flight is not touched by the change.
    await data.job({ userId, kind: 'write_story', status: 'running' });
    const rows = async () => ({
      jobs: await prisma.generationJob.findMany({ where: { requestedByUserId: userId }, orderBy: { id: 'asc' } }),
      allJobs: await prisma.generationJob.count(),
      queue: await prisma.queueItem.findMany({ where: { userId }, orderBy: { position: 'asc' } }),
    });
    const states = async () => {
      const result = await call('GET', '/queue', { token: await tokenFor(userId) });
      expect(result.status).toBe(200);
      return QueueResponseSchema.parse(result.json).items.map((item) => item.state);
    };
    const before = await rows();
    topUpRun.mockClear();
    jobQueue.enqueued = [];

    expect(await states()).toEqual(['ready', 'not_ready']);
    expect((await putVoice(userId, { voiceSlug: await slugOf(newVoiceId) })).status).toBe(200);
    expect(await states()).toEqual(['not_ready', 'not_ready']);
    expect(await rows()).toEqual(before);
    // The audio of the old voice is still there, so switching back restores "ready".
    expect((await putVoice(userId, { voiceSlug: await slugOf(oldVoiceId) })).status).toBe(200);
    expect(await states()).toEqual(['ready', 'not_ready']);

    expect(await rows()).toEqual(before);
    expect(topUpRun).not.toHaveBeenCalled();
    expect(jobQueue.enqueued).toEqual([]);
  });
});

describe('PUT /api/me/interests', () => {
  const TYPED = ['кофе', 'дождь', 'чай'];
  const NEW_BODY = { interestSlugs: ['space', 'music'], customInterests: ['дождь', 'поезда', 'кофе', 'маяки'] };
  const typedRows = (userId: string) =>
    prisma.userCustomInterest.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  // Everything the route may or may not write, with ids and times, so a rewrite shows too.
  async function storedSettings(userId: string) {
    const [preference, interests, customInterests] = await Promise.all([
      prisma.userPreference.findUniqueOrThrow({ where: { userId } }),
      prisma.userInterest.findMany({ where: { userId }, orderBy: { interestId: 'asc' } }),
      typedRows(userId),
    ]);
    return { preference, interests, customInterests };
  }
  const onboarded = async (customInterests: string[] = TYPED) => {
    const userId = newUserId();
    expect((await putOnboarding(userId, { ...BODY_A, customInterests })).status).toBe(200);
    return userId;
  };
  const expected = (interestSlugs: string[], customInterests: string[]) => ({
    ...EXPECTED_A,
    preferences: { ...EXPECTED_A.preferences, interestSlugs, customInterests },
  });

  it('writes only the difference: a kept typed row keeps its id and time, and GET /me reads it back', async () => {
    const userId = await onboarded();
    const before = await storedSettings(userId);

    const result = await putInterests(userId, NEW_BODY);

    expect(result.status).toBe(200);
    // Kept titles stay in their old order; new ones follow in request order.
    const read = expected(['space', 'music'], ['кофе', 'дождь', 'поезда', 'маяки']);
    const parsed = MeResponseSchema.parse(result.json);
    expect(parsed.preferences?.interestSlugs.slice().sort()).toEqual(['music', 'space']);
    expect(parsed.preferences?.customInterests).toEqual(read.preferences.customInterests);
    expect((await getMe(userId)).json).toEqual(result.json);

    const after = await storedSettings(userId);
    expect(after.preference).toEqual(before.preference);
    expect(after.customInterests.slice(0, 2)).toEqual(before.customInterests.slice(0, 2));
    expect(after.customInterests.map((row) => row.title)).toEqual(read.preferences.customInterests);
    const oldIds = before.customInterests.map((row) => row.id);
    expect(after.customInterests.slice(2).filter((row) => oldIds.includes(row.id))).toEqual([]);
    expect(after.interests).toHaveLength(2);
    // The catalogue row that stays is not recreated.
    const space = await prisma.interest.findUniqueOrThrow({ where: { slug: 'space' } });
    const spaceRow = (rows: typeof before.interests) => rows.find((row) => row.interestId === space.id);
    expect(spaceRow(after.interests)).toEqual(spaceRow(before.interests));
  });

  it('changes nothing when the saved lists are sent again, normalised or not', async () => {
    const userId = await onboarded();
    const before = await storedSettings(userId);
    const result = await putInterests(userId, {
      interestSlugs: BODY_A.interestSlugs,
      customInterests: [' ЧАЙ ', 'кофе', 'Дождь'],
    });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(expected(EXPECTED_A.preferences.interestSlugs, TYPED));
    expect(await storedSettings(userId)).toEqual(before);
  });

  it("empties one list at a time and deletes only the caller's rows", async () => {
    const userId = await onboarded();
    const other = await onboarded();
    const otherBefore = await storedSettings(other);

    const noTyped = await putInterests(userId, { interestSlugs: ['space'], customInterests: [] });
    expect(noTyped.status).toBe(200);
    expect(noTyped.json).toEqual(expected(['space'], []));
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 1, customInterests: 0 });
    expect(await storedSettings(other)).toEqual(otherBefore);

    const noCatalogue = await putInterests(userId, { interestSlugs: [], customInterests: ['кофе'] });
    expect(noCatalogue.status).toBe(200);
    expect(noCatalogue.json).toEqual(expected([], ['кофе']));
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 0, customInterests: 1 });
    expect(await storedSettings(other)).toEqual(otherBefore);
  });

  it('answers 401 without a token', async () => {
    expectError(await call('PUT', '/me/interests', { body: NEW_BODY }), 401, 'unauthorized');
  });

  it('refuses a body that names a user and changes neither person', async () => {
    const a = await onboarded();
    const b = await onboarded();
    const before = [await storedSettings(a), await storedSettings(b)];
    expectError(await putInterests(a, { ...NEW_BODY, userId: b }), 400, 'validation_failed');
    expect([await storedSettings(a), await storedSettings(b)]).toEqual(before);
  });

  it("changes only the caller's interests, whatever a header or the query says", async () => {
    const a = await onboarded();
    const b = await onboarded();
    const before = await storedSettings(b);
    const result = await call('PUT', `/me/interests?userId=${b}`, {
      token: await tokenFor(a),
      body: { interestSlugs: [], customInterests: ['маяки'] },
      headers: { 'x-user-id': b },
    });
    expect(result.status).toBe(200);
    expect((await getMe(a)).json).toEqual(expected([], ['маяки']));
    expect(await storedSettings(b)).toEqual(before);
  });

  it.each([
    ['without customInterests', { interestSlugs: ['space'] }],
    ['without interestSlugs', { customInterests: ['кофе'] }],
    ['with no interest at all', { interestSlugs: [], customInterests: [] }],
  ])('answers 400 for a body %s and changes nothing', async (_label, body) => {
    const userId = await onboarded();
    const before = await storedSettings(userId);
    expectError(await putInterests(userId, body), 400, 'validation_failed');
    expect(await storedSettings(userId)).toEqual(before);
  });

  it('answers 400 before onboarding and creates no rows', async () => {
    const stranger = newUserId();
    expectError(await putInterests(stranger, NEW_BODY), 400, 'validation_failed');
    expect(await rowCounts(stranger)).toEqual({ users: 0, preferences: 0, interests: 0, customInterests: 0 });

    const signedInOnly = newUserId();
    await getMe(signedInOnly); // creates the users row
    expectError(await putInterests(signedInOnly, NEW_BODY), 400, 'validation_failed');
    expect(await rowCounts(signedInOnly)).toEqual({ users: 1, preferences: 0, interests: 0, customInterests: 0 });
  });

  it('answers 422 for an unknown slug, an inactive one or a new colliding title, and changes nothing', async () => {
    const userId = await onboarded();
    const before = await storedSettings(userId);

    expectError(
      await putInterests(userId, { ...NEW_BODY, interestSlugs: ['music', 'no-such-interest'] }),
      422,
      'unknown_interest',
    );
    const collision = await putInterests(userId, { interestSlugs: ['art'], customInterests: ['маяки', ' МУЗЫКА '] });
    expectError(collision, 422, 'validation_failed');
    expect(collision.text.toLowerCase()).not.toContain('музыка');
    // NEW_BODY holds `space`; afterEach turns it on again.
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: false } });
    expectError(await putInterests(userId, NEW_BODY), 422, 'unknown_interest');

    expect(await storedSettings(userId)).toEqual(before);
  });

  it('does not let a kept title that now repeats a catalogue title block saving', async () => {
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: false } });
    const userId = newUserId();
    expect((await putOnboarding(userId, { ...BODY_B, customInterests: ['космос'] })).status).toBe(200);
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: true } });
    const [kept] = await typedRows(userId);

    const result = await putInterests(userId, { interestSlugs: ['art'], customInterests: ['космос', 'кофе'] });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ preferences: { interestSlugs: ['art'], customInterests: ['космос', 'кофе'] } });
    expect((await typedRows(userId))[0]).toEqual(kept);
  });

  it('removes a saved interest that was deactivated, once a save leaves it out', async () => {
    const userId = await onboarded();
    await prisma.interest.update({ where: { slug: 'space' }, data: { isActive: false } });
    const result = await putInterests(userId, { interestSlugs: ['history', 'ocean'], customInterests: TYPED });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(expected(['history', 'ocean'], TYPED));
    expect((await rowCounts(userId)).interests).toBe(2);
  });

  it('creates no job, never runs the top-up and leaves the queue, the styles and the voice alone', async () => {
    const voiceId = await data.voice();
    const userId = await data.user({ voiceId, styles: ['history'] });
    await prisma.userCustomInterest.create({ data: { userId, title: 'кофе' } });
    const [kept] = await typedRows(userId);
    const plain = await data.topic();
    await data.queueItem(userId, plain.topicId, 1);
    // A waiting topic search that names the typed row by id.
    await data.job({
      userId,
      kind: 'suggest_topics',
      status: 'pending',
      payload: { kind: 'suggest_topics', userId, selection: { interestIds: [], customInterestIds: [kept.id] } },
    });
    const rows = async () => ({
      jobs: await prisma.generationJob.findMany({ where: { requestedByUserId: userId }, orderBy: { id: 'asc' } }),
      allJobs: await prisma.generationJob.count(),
      queue: await prisma.queueItem.findMany({ where: { userId }, orderBy: { position: 'asc' } }),
      preference: await prisma.userPreference.findUniqueOrThrow({ where: { userId } }),
    });
    const before = await rows();
    topUpRun.mockClear();
    jobQueue.enqueued = [];

    const result = await putInterests(userId, { interestSlugs: ['space'], customInterests: ['кофе', 'маяки'] });

    expect(result.status).toBe(200);
    expect(await rows()).toEqual(before);
    expect((await typedRows(userId))[0]).toEqual(kept);
    expect(topUpRun).not.toHaveBeenCalled();
    expect(jobQueue.enqueued).toEqual([]);
  });
});

// Holds a row lock on the user in its own transaction until release() is called.
async function holdUserLock(userId: string, mode: 'FOR UPDATE' | 'FOR NO KEY UPDATE') {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));
  const holder = prisma.$transaction(
    async (tx) => {
      if (mode === 'FOR UPDATE') {
        await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
      }
      locked();
      await released;
    },
    { timeout: 20_000 },
  );
  await lockTaken;
  return {
    release: async () => {
      release();
      await holder;
    },
  };
}

const waits = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms))]);

describe('the row lock that serialises submits by one user', () => {
  it('FOR UPDATE through the Prisma pg adapter really locks the row: a second locker with NOWAIT is refused', async () => {
    const userId = newUserId();
    await getMe(userId); // creates the users row
    const lock = await holdUserLock(userId, 'FOR UPDATE');
    try {
      await expect(
        prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE NOWAIT`),
      ).rejects.toBeDefined();
    } finally {
      await lock.release();
    }
    // Released: the same statement now succeeds.
    await expect(
      prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE NOWAIT`),
    ).resolves.toBeDefined();
  });

  it('a PUT waits while another transaction holds the user row, and completes once it is released', async () => {
    const userId = newUserId();
    await getMe(userId);
    // FOR NO KEY UPDATE does not conflict with the key-share lock that the foreign
    // keys of user_preferences and user_interests take, but it does conflict with
    // the FOR UPDATE of the service. So the PUT can only wait because the service
    // takes its own FOR UPDATE lock, not because of the foreign keys.
    const lock = await holdUserLock(userId, 'FOR NO KEY UPDATE');
    try {
      const put = putOnboarding(userId, BODY_A);
      expect(await waits(put, 1000)).toBe(true);
      expect((await rowCounts(userId)).preferences).toBe(0);
      await lock.release();
      const result = await put;
      expect(result.status).toBe(200);
      expect(result.json).toEqual(EXPECTED_A);
    } finally {
      await lock.release().catch(() => undefined);
    }
  });

  it('a voice change waits for the same lock', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    // The update does not touch the foreign key columns, so it can only wait because the
    // service takes its own FOR UPDATE lock.
    const lock = await holdUserLock(userId, 'FOR NO KEY UPDATE');
    try {
      const put = putVoice(userId, { voiceSlug: 'lev' });
      expect(await waits(put, 1000)).toBe(true);
      expect((await getMe(userId)).json).toEqual(EXPECTED_A);
      await lock.release();
      expect((await put).status).toBe(200);
      expect((await getMe(userId)).json).toMatchObject({ preferences: { voiceSlug: 'lev' } });
    } finally {
      await lock.release().catch(() => undefined);
    }
  });

  it('an interests change waits for the same lock', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    // It does not update the users row, so it can only wait because the service takes its
    // own FOR UPDATE lock. The new rows' foreign key check (FOR KEY SHARE) passes this one.
    const lock = await holdUserLock(userId, 'FOR NO KEY UPDATE');
    try {
      const put = putInterests(userId, { interestSlugs: ['art'], customInterests: [] });
      expect(await waits(put, 1000)).toBe(true);
      expect((await getMe(userId)).json).toEqual(EXPECTED_A);
      await lock.release();
      expect((await put).status).toBe(200);
      expect((await getMe(userId)).json).toMatchObject({ preferences: { interestSlugs: ['art'] } });
    } finally {
      await lock.release().catch(() => undefined);
    }
  });

  it("does not make one user's PUT wait for another user's lock", async () => {
    const a = newUserId();
    const b = newUserId();
    await getMe(a);
    const lock = await holdUserLock(a, 'FOR UPDATE');
    try {
      const result = await putOnboarding(b, BODY_B);
      expect(result.status).toBe(200);
    } finally {
      await lock.release();
    }
  });
});
