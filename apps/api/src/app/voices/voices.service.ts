import { Injectable } from '@nestjs/common';
import type { VoicesResponse } from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VoicesService {
  constructor(private readonly prisma: PrismaService) {}

  // The catalogue is the same for every user, so nothing here is scoped by a
  // user id. Only active rows are served, and only slug, name and description are
  // selected: the TTS provider, the provider voice id and the sample path never
  // leave the server. The order is stable (sort_order, then slug).
  async listActive(): Promise<VoicesResponse> {
    const rows = await this.prisma.voice.findMany({
      where: { isActive: true },
      select: { slug: true, name: true, description: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return { voices: rows };
  }
}
