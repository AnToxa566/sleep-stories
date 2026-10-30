import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, MeResponseSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../auth/access-token-verifier';
import { AppModule } from '../app.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { assertLocalDatabase } from '../../test-support/assert-local-database';

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

const BODY_A = { voiceSlug: 'anna', styles: ['history', 'facts'], interestSlugs: ['space', 'history', 'ocean'] };
const BODY_B = { voiceSlug: 'lev', styles: ['fairy_tale'], interestSlugs: ['art', 'music'] };

// The body as it must read back: styles in canonical order, interests by sort order.
const EXPECTED_A = {
  onboardingCompleted: true,
  preferences: { voiceSlug: 'anna', styles: ['facts', 'history'], interestSlugs: ['history', 'space', 'ocean'] },
};
const EXPECTED_B = {
  onboardingCompleted: true,
  preferences: { voiceSlug: 'lev', styles: ['fairy_tale'], interestSlugs: ['music', 'art'] },
};

async function rowCounts(userId: string) {
  const [users, preferences, interests] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.userPreference.count({ where: { userId } }),
    prisma.userInterest.count({ where: { userId } }),
  ]);
  return { users, preferences, interests };
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
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api'); // main.ts does this; the test app has to as well
  app.useLogger(false);
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
  usersBefore = await prisma.user.count();
});

afterEach(async () => {
  // Tests that deactivate reference data restore it even when they fail.
  await prisma.voice.updateMany({ where: { slug: 'anna' }, data: { isActive: true } });
  await prisma.interest.updateMany({ where: { slug: 'space' }, data: { isActive: true } });
});

afterAll(async () => {
  if (prisma) {
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
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0 });
    const result = await getMe(userId);
    expect(result.status).toBe(200);
    expect(MeResponseSchema.parse(result.json)).toEqual({ onboardingCompleted: false, preferences: null });
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 0, interests: 0 });
    // A second GET changes nothing.
    await getMe(userId);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 0, interests: 0 });
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
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3 });
  });

  it('is idempotent: an identical PUT repeated gives 200 and the same rows', async () => {
    const userId = newUserId();
    await putOnboarding(userId, BODY_A);
    const interestsBefore = await prisma.userInterest.findMany({ where: { userId }, orderBy: { interestId: 'asc' } });
    const preferenceBefore = await prisma.userPreference.findUniqueOrThrow({ where: { userId } });

    const again = await putOnboarding(userId, BODY_A);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(EXPECTED_A);
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3 });
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
    const changed = { voiceSlug: 'vera', styles: ['history'], interestSlugs: ['ocean', 'music'] };
    const result = await putOnboarding(userId, changed);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      onboardingCompleted: true,
      preferences: { voiceSlug: 'vera', styles: ['history'], interestSlugs: ['music', 'ocean'] },
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
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3 });
  });

  it('serialises concurrent PUTs with different bodies: the final state is exactly one of them', async () => {
    const userId = newUserId();
    const token = await tokenFor(userId);
    const bodyOther = { voiceSlug: 'mikhail', styles: ['facts'], interestSlugs: ['nature', 'science'] };
    const expectedOther = {
      onboardingCompleted: true,
      preferences: { voiceSlug: 'mikhail', styles: ['facts'], interestSlugs: ['science', 'nature'] },
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
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0 });
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
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0 });
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
    expect(await rowCounts(userId)).toEqual({ users: 1, preferences: 1, interests: 3 });
  });

  it.each([
    ['an extra userId key', { ...BODY_A, userId: randomUUID() }],
    ['empty styles', { ...BODY_A, styles: [] }],
    ['empty interests', { ...BODY_A, interestSlugs: [] }],
    ['a wrong type', { ...BODY_A, voiceSlug: 42 }],
  ])('answers 400 validation_failed for %s and creates no rows', async (_label, body) => {
    const userId = newUserId();
    expectError(await putOnboarding(userId, body), 400, 'validation_failed');
    expect(await rowCounts(userId)).toEqual({ users: 0, preferences: 0, interests: 0 });
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
    expect(await rowCounts(a)).toEqual({ users: 1, preferences: 1, interests: 3 });
    expect(await rowCounts(b)).toEqual({ users: 1, preferences: 1, interests: 2 });
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
    expect(await rowCounts(a)).toEqual({ users: 1, preferences: 1, interests: 3 });
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
