import { VoicesResponseSchema } from '@sleep-stories/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../providers/storage/storage.service';
import { SAMPLE_URL_TTL_SECONDS, VoicesService } from './voices.service';

interface Row {
  slug: string;
  name: string;
  description: string;
  sampleAudioPath: string;
}

const rowFor = (slug: string, name: string, description: string): Row => ({
  slug,
  name,
  description,
  sampleAudioPath: `voices/${slug}/sample.mp3`,
});

const urlFor = (path: string) => `http://storage.test/sign/${path}?token=t`;

function makeService(rows: Row[], signMany?: jest.Mock) {
  const findMany = jest.fn(async () => rows);
  const prisma = { voice: { findMany } };
  const sign = signMany ?? jest.fn(async (paths: string[]) => paths.map(urlFor));
  const storage = { signMany: sign };
  return {
    service: new VoicesService(prisma as unknown as PrismaService, storage as unknown as StorageService),
    findMany,
    sign,
  };
}

describe('VoicesService.listActive', () => {
  it('reads only active rows and only the columns it needs, ordered by sort order and then slug', async () => {
    const { service, findMany } = makeService([]);
    await service.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { slug: true, name: true, description: true, sampleAudioPath: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  });

  it('signs all sample paths in one batch with the 10-minute TTL', async () => {
    const { service, sign } = makeService([rowFor('maxim', 'Максим', 'a'), rowFor('anna', 'Анна', 'b')]);
    await service.listActive();
    expect(SAMPLE_URL_TTL_SECONDS).toBe(600);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(['voices/maxim/sample.mp3', 'voices/anna/sample.mp3'], 600);
  });

  it('returns slug, name, description and the matching sampleUrl, never the path', async () => {
    const { service } = makeService([
      rowFor('maxim', 'Максим', 'спокойный, размеренный'),
      rowFor('anna', 'Анна', 'тёплый, нежный'),
    ]);
    const result = await service.listActive();
    expect(VoicesResponseSchema.parse(result)).toEqual({
      voices: [
        { slug: 'maxim', name: 'Максим', description: 'спокойный, размеренный', sampleUrl: urlFor('voices/maxim/sample.mp3') },
        { slug: 'anna', name: 'Анна', description: 'тёплый, нежный', sampleUrl: urlFor('voices/anna/sample.mp3') },
      ],
    });
    expect(Object.keys(result.voices[0]).sort()).toEqual(['description', 'name', 'sampleUrl', 'slug']);
  });

  it('returns an empty list when nothing is active', async () => {
    const { service } = makeService([]);
    expect(await service.listActive()).toEqual({ voices: [] });
  });

  it('rejects the whole request when signing fails', async () => {
    const failure = new Error('Storage signing failed');
    const { service } = makeService([rowFor('maxim', 'Максим', 'a')], jest.fn(async () => Promise.reject(failure)));
    await expect(service.listActive()).rejects.toBe(failure);
  });
});
