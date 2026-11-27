import { BadRequestException, HttpException, UnprocessableEntityException } from '@nestjs/common';
import { ApiErrorResponseSchema } from '@sleep-stories/contracts';
import type { MeResponse } from '@sleep-stories/contracts';
import type { PrismaService } from '../../platform/prisma/prisma.service';
import type { MeService } from './me.service';
import { PreferencesUpdateService } from './preferences-update.service';

const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const VOICE = { id: 'voice-id-lev' };
const ME: MeResponse = {
  onboardingCompleted: true,
  preferences: { voiceSlug: 'lev', styles: ['facts'], interestSlugs: ['space'], customInterests: [] },
};

// A fake transaction client that records every call in order. It has only what the service
// may touch, so a write to any other table fails the test with a TypeError.
function makeService(
  options: { userExists?: boolean; voice?: typeof VOICE | null; updated?: number } = {},
) {
  const calls: { name: string; args: unknown }[] = [];
  const record = (name: string, result: unknown) =>
    jest.fn(async (args: unknown) => {
      calls.push({ name, args });
      return result;
    });
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ name: 'lockUserRow', args: { sql: strings.join('?'), values } });
      return options.userExists === false ? [] : [{ id: USER_ID }];
    }),
    voice: { findFirst: record('voice.findFirst', options.voice === undefined ? VOICE : options.voice) },
    userPreference: { updateMany: record('userPreference.updateMany', { count: options.updated ?? 1 }) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: unknown) => unknown) => {
      const result = await fn(tx);
      calls.push({ name: 'commit', args: undefined });
      return result;
    }),
  };
  const me = { getMe: record('me.getMe', ME) };
  const service = new PreferencesUpdateService(
    prisma as unknown as PrismaService,
    me as unknown as MeService,
  );
  return { service, calls, names: () => calls.map((call) => call.name) };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (reason: unknown) => reason,
  );
  return {
    error,
    body: ApiErrorResponseSchema.parse((error as HttpException).getResponse()),
  };
}

describe('PreferencesUpdateService.changeVoice', () => {
  it('locks the users row first, then writes only the voice, and reads the answer after the commit', async () => {
    const { service, calls, names } = makeService();

    expect(await service.changeVoice(USER_ID, { voiceSlug: 'lev' })).toEqual(ME);

    expect(names()).toEqual([
      'lockUserRow',
      'voice.findFirst',
      'userPreference.updateMany',
      'commit',
      'me.getMe',
    ]);
    expect(calls[0].args).toMatchObject({ values: [USER_ID] });
    expect(calls[1].args).toEqual({ where: { slug: 'lev', isActive: true }, select: { id: true } });
    expect(calls[2].args).toEqual({ where: { userId: USER_ID }, data: { voiceId: VOICE.id } });
    expect(calls[4].args).toBe(USER_ID);
  });

  it('refuses an unknown or inactive voice with 422 unknown_voice and writes nothing', async () => {
    const { service, names } = makeService({ voice: null });

    const { error, body } = await refusal(service.changeVoice(USER_ID, { voiceSlug: 'nope' }));

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(body).toMatchObject({ statusCode: 422, code: 'unknown_voice' });
    expect(names()).toEqual(['lockUserRow', 'voice.findFirst']);
  });

  it('refuses a person without preferences with 400 and neither commits nor reads', async () => {
    const { service, names } = makeService({ updated: 0 });

    const { error, body } = await refusal(service.changeVoice(USER_ID, { voiceSlug: 'lev' }));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
      message: 'Onboarding is not finished',
    });
    expect(names()).toEqual(['lockUserRow', 'voice.findFirst', 'userPreference.updateMany']);
  });

  it('refuses a person without a users row with 400 and attempts no write', async () => {
    const { service, names } = makeService({ userExists: false });

    const { body } = await refusal(service.changeVoice(USER_ID, { voiceSlug: 'lev' }));

    expect(body).toMatchObject({ statusCode: 400, code: 'validation_failed' });
    expect(names()).toEqual(['lockUserRow', 'voice.findFirst']);
  });
});
