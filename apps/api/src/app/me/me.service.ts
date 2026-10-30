import { Injectable } from '@nestjs/common';
import type { MeResponse } from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { inCanonicalOrder } from './story-styles';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  // Whether the user finished onboarding is decided on the server: a
  // user_preferences row exists. A first-time user gets their users row here.
  // Every query is scoped by `userId`, which comes from the verified token.
  async getMe(userId: string): Promise<MeResponse> {
    await this.users.ensureExists(userId);

    // Preferences and interests are read in one snapshot (REPEATABLE READ) so a
    // concurrent PUT cannot show a new voice with the old interests. It costs one
    // transaction round trip per GET.
    const { preferences, interests } = await this.prisma.$transaction(
      async (tx) => ({
        preferences: await tx.userPreference.findUnique({
          where: { userId },
          select: { styles: true, voice: { select: { slug: true } } },
        }),
        interests: await tx.userInterest.findMany({
          where: { userId },
          select: { interest: { select: { slug: true } } },
          orderBy: [{ interest: { sortOrder: 'asc' } }, { interest: { slug: 'asc' } }],
        }),
      }),
      { isolationLevel: 'RepeatableRead' },
    );

    if (preferences === null) {
      return { onboardingCompleted: false, preferences: null };
    }
    return {
      onboardingCompleted: true,
      preferences: {
        voiceSlug: preferences.voice.slug,
        styles: inCanonicalOrder(preferences.styles),
        interestSlugs: interests.map((row) => row.interest.slug),
      },
    };
  }
}
