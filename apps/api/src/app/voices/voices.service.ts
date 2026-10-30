import { Injectable } from '@nestjs/common';
import type { VoicesResponse } from '@sleep-stories/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';

// How long a sample URL works. The app asks for the list when the voice step opens and
// the person may listen for a while before tapping play, so the window must cover a
// slow screen; it is still short enough that a leaked URL is useless soon. A sample is
// not secret content, so this is a hygiene limit, not a paywall.
export const SAMPLE_URL_TTL_SECONDS = 10 * 60;

@Injectable()
export class VoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // The catalogue is the same for every user, so nothing here is scoped by a
  // user id. Only active rows are served. The TTS provider and the provider voice id
  // are never selected. The sample path is selected only to be signed: it is replaced
  // by a short-lived signed URL (`sampleUrl`) and never leaves the server. All rows are
  // signed in one batch; a signing failure rejects the whole request (a 5xx), because
  // the app cannot play a voice without its sample. The order is stable (sort_order,
  // then slug).
  async listActive(): Promise<VoicesResponse> {
    const rows = await this.prisma.voice.findMany({
      where: { isActive: true },
      select: { slug: true, name: true, description: true, sampleAudioPath: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
    const urls = await this.storage.signMany(
      rows.map((row) => row.sampleAudioPath),
      SAMPLE_URL_TTL_SECONDS,
    );
    return {
      voices: rows.map((row, index) => ({
        slug: row.slug,
        name: row.name,
        description: row.description,
        sampleUrl: urls[index],
      })),
    };
  }
}
