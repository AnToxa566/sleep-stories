import { UnprocessableEntityException } from '@nestjs/common';
import { ApiErrorResponseSchema } from '@sleep-stories/contracts';
import type { CompleteOnboardingRequest } from '@sleep-stories/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OnboardingService } from './onboarding.service';

const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_USER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const VOICE = { id: 'voice-id-anna', slug: 'anna' };
// In sort order, as the query returns them (it has orderBy sortOrder).
const INTERESTS = [
  { id: 'interest-id-history', slug: 'history', sortOrder: 1 },
  { id: 'interest-id-space', slug: 'space', sortOrder: 2 },
];

const REQUEST: CompleteOnboardingRequest = {
  voiceSlug: 'anna',
  styles: ['history', 'facts'],
  interestSlugs: ['space', 'history'],
};

// The shapes of the recorded write arguments that these tests read.
interface CallArgs {
  where: { userId?: string; interestId: { notIn: string[] } };
  data: { userId: string; interestId: string }[];
  skipDuplicates: boolean;
  create: { userId: string };
}

interface Call {
  name: string;
  args: unknown;
}

// A fake transaction client that records every call in order. Reads are marked so
// the tests can tell writes from queries.
function makeFakeTx(options: { voice?: typeof VOICE | null; interests?: typeof INTERESTS } = {}) {
  const calls: Call[] = [];
  const record = (name: string, result: unknown) =>
    jest.fn(async (args: unknown) => {
      calls.push({ name, args });
      return result;
    });
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ name: 'queryRaw', args: { sql: strings.join('?'), values } });
    return [];
  });
  const tx = {
    $queryRaw: queryRaw,
    user: { createMany: record('user.createMany', { count: 1 }) },
    voice: { findFirst: record('voice.findFirst', options.voice === undefined ? VOICE : options.voice) },
    interest: { findMany: record('interest.findMany', options.interests ?? INTERESTS) },
    userInterest: {
      deleteMany: record('userInterest.deleteMany', { count: 0 }),
      createMany: record('userInterest.createMany', { count: 2 }),
    },
    userPreference: { upsert: record('userPreference.upsert', {}) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)) };
  const service = new OnboardingService(
    prisma as unknown as PrismaService,
    new UsersService(prisma as unknown as PrismaService),
  );
  return { service, calls };
}

const WRITES = ['user.createMany', 'userInterest.deleteMany', 'userInterest.createMany', 'userPreference.upsert'];
const writeNames = (calls: Call[]) => calls.map((call) => call.name).filter((name) => WRITES.includes(name));

describe('OnboardingService.complete', () => {
  it('runs the steps in order, with the preferences upsert as the last write', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);

    expect(calls.map((call) => call.name)).toEqual([
      'user.createMany',
      'queryRaw',
      'voice.findFirst',
      'interest.findMany',
      'userInterest.deleteMany',
      'userInterest.createMany',
      'userPreference.upsert',
    ]);
    expect(writeNames(calls).at(-1)).toBe('userPreference.upsert');
  });

  it('locks the row of the token user with FOR UPDATE, passing the id as a parameter', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);
    const lock = calls.find((call) => call.name === 'queryRaw')?.args as { sql: string; values: unknown[] };
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.values).toEqual([USER_ID]);
    expect(lock.sql).not.toContain(USER_ID);
  });

  it('creates the user with ON CONFLICT DO NOTHING semantics (skipDuplicates) and no other field', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);
    expect(calls[0]).toEqual({
      name: 'user.createMany',
      args: { data: [{ id: USER_ID }], skipDuplicates: true },
    });
  });

  it('throws 422 unknown_voice before any write except ensureExists, and writes nothing else', async () => {
    const { service, calls } = makeFakeTx({ voice: null });
    const error = await service.complete(USER_ID, REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(ApiErrorResponseSchema.parse((error as UnprocessableEntityException).getResponse())).toMatchObject({
      statusCode: 422,
      code: 'unknown_voice',
    });
    // Only the idempotent users insert ran; the whole transaction rolls back anyway.
    expect(writeNames(calls)).toEqual(['user.createMany']);
    expect(calls.map((call) => call.name)).not.toContain('interest.findMany');
  });

  it('throws 422 unknown_interest when any slug does not resolve, before the interest and preference writes', async () => {
    const { service, calls } = makeFakeTx({ interests: [INTERESTS[1]] });
    const error = await service.complete(USER_ID, REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(ApiErrorResponseSchema.parse((error as UnprocessableEntityException).getResponse())).toMatchObject({
      statusCode: 422,
      code: 'unknown_interest',
    });
    expect(writeNames(calls)).toEqual(['user.createMany']);
  });

  it('looks up only active voices and interests', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);
    const voiceWhere = (calls.find((c) => c.name === 'voice.findFirst')?.args as { where: unknown }).where;
    const interestWhere = (calls.find((c) => c.name === 'interest.findMany')?.args as { where: unknown }).where;
    expect(voiceWhere).toEqual({ slug: 'anna', isActive: true });
    expect(interestWhere).toEqual({ slug: { in: ['space', 'history'] }, isActive: true });
  });

  it('scopes every user-data write by the token user id and never by anything else', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);
    const args = (name: string) => calls.find((call) => call.name === name)?.args as CallArgs;

    expect(args('userInterest.deleteMany').where.userId).toBe(USER_ID);
    expect(args('userInterest.createMany').data.every((row) => row.userId === USER_ID)).toBe(true);
    expect(args('userPreference.upsert').where).toEqual({ userId: USER_ID });
    expect(args('userPreference.upsert').create.userId).toBe(USER_ID);
    expect(JSON.stringify(calls)).not.toContain(OTHER_USER_ID);
  });

  it('keeps exactly the requested interests: deletes the others, inserts the set, skipping duplicates', async () => {
    const { service, calls } = makeFakeTx();
    await service.complete(USER_ID, REQUEST);
    const args = (name: string) => calls.find((call) => call.name === name)?.args as CallArgs;
    expect(args('userInterest.deleteMany').where.interestId.notIn).toEqual(['interest-id-history', 'interest-id-space']);
    expect(args('userInterest.createMany').skipDuplicates).toBe(true);
    expect(args('userInterest.createMany').data.map((row) => row.interestId)).toEqual([
      'interest-id-history',
      'interest-id-space',
    ]);
  });

  it('stores styles in canonical order and returns the completed state with interests by sort order', async () => {
    const { service, calls } = makeFakeTx();
    const result = await service.complete(USER_ID, REQUEST);
    const upsert = calls.find((call) => call.name === 'userPreference.upsert')?.args as { create: { styles: string[] } };
    expect(upsert.create.styles).toEqual(['facts', 'history']);
    expect(result).toEqual({
      onboardingCompleted: true,
      preferences: { voiceSlug: 'anna', styles: ['facts', 'history'], interestSlugs: ['history', 'space'] },
    });
  });

  it('returns the same state for a repeated identical request', async () => {
    const first = await makeFakeTx().service.complete(USER_ID, REQUEST);
    const second = await makeFakeTx().service.complete(USER_ID, REQUEST);
    expect(second).toEqual(first);
  });

  it('puts no user id or email in the response', async () => {
    const result = await makeFakeTx().service.complete(USER_ID, REQUEST);
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });
});
