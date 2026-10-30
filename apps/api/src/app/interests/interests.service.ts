import { Injectable } from '@nestjs/common';
import type { InterestsResponse } from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InterestsService {
  constructor(private readonly prisma: PrismaService) {}

  // The catalogue is the same for every user, so nothing here is scoped by a
  // user id. Only active rows are served; the order is stable (sort_order, then
  // slug) so the chips do not jump between requests.
  async listActive(): Promise<InterestsResponse> {
    const rows = await this.prisma.interest.findMany({
      where: { isActive: true },
      select: { slug: true, title: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return { interests: rows };
  }
}
