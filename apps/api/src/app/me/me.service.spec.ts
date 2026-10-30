import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MeService } from './me.service';

const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function makeService(data: {
  preferences: { styles: string[]; voice: { slug: string } } | null;
  interests: { interest: { slug: string } }[];
  customInterests?: { title: string }[];
}) {
  const calls: { name: string; args: unknown }[] = [];
  const tx = {
    userPreference: {
      findUnique: jest.fn(async (args: unknown) => {
        calls.push({ name: 'userPreference.findUnique', args });
        return data.preferences;
      }),
    },
    userInterest: {
      findMany: jest.fn(async (args: unknown) => {
        calls.push({ name: 'userInterest.findMany', args });
        return data.interests;
      }),
    },
    userCustomInterest: {
      findMany: jest.fn(async (args: unknown) => {
        calls.push({ name: 'userCustomInterest.findMany', args });
        return data.customInterests ?? [];
      }),
    },
    user: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: unknown) => unknown, options: unknown) => {
      calls.push({ name: '$transaction', args: options });
      return fn(tx);
    }),
  };
  const service = new MeService(prisma as unknown as PrismaService, new UsersService(prisma as unknown as PrismaService));
  return { service, calls, prisma };
}

describe('MeService.getMe', () => {
  it('returns the not-completed state when there is no user_preferences row', async () => {
    const { service } = makeService({ preferences: null, interests: [] });
    expect(await service.getMe(USER_ID)).toEqual({ onboardingCompleted: false, preferences: null });
  });

  it('returns the completed state, styles in canonical order, interests as read in sort order', async () => {
    const { service } = makeService({
      preferences: { styles: ['history', 'facts'], voice: { slug: 'vera' } },
      interests: [{ interest: { slug: 'history' } }, { interest: { slug: 'space' } }],
      customInterests: [{ title: 'кофе' }, { title: 'старые поезда' }],
    });
    expect(await service.getMe(USER_ID)).toEqual({
      onboardingCompleted: true,
      preferences: { voiceSlug: 'vera', styles: ['facts', 'history'], interestSlugs: ['history', 'space'],
        customInterests: ['кофе', 'старые поезда'],
      },
    });
  });

  it('scopes both reads by the token user id and reads them in one snapshot', async () => {
    const { service, calls, prisma } = makeService({ preferences: null, interests: [] });
    await service.getMe(USER_ID);
    expect(prisma.user.createMany).toHaveBeenCalledWith({ data: [{ id: USER_ID }], skipDuplicates: true });
    const where = (name: string) => (calls.find((call) => call.name === name)?.args as { where: unknown }).where;
    expect(where('userPreference.findUnique')).toEqual({ userId: USER_ID });
    expect(where('userInterest.findMany')).toEqual({ userId: USER_ID });
    expect(where('userCustomInterest.findMany')).toEqual({ userId: USER_ID });
    expect(calls.find((c) => c.name === 'userCustomInterest.findMany')?.args).toMatchObject({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(calls.find((call) => call.name === '$transaction')?.args).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('never includes the user id in the response', async () => {
    const { service } = makeService({
      preferences: { styles: ['facts'], voice: { slug: 'anna' } },
      interests: [{ interest: { slug: 'space' } }],
    });
    expect(JSON.stringify(await service.getMe(USER_ID))).not.toContain(USER_ID);
  });
});
