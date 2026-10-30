import { VoicesResponseSchema } from '@sleep-stories/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { VoicesService } from './voices.service';

function makeService(rows: { slug: string; name: string; description: string }[]) {
  const findMany = jest.fn(async () => rows);
  const prisma = { voice: { findMany } };
  return { service: new VoicesService(prisma as unknown as PrismaService), findMany };
}

describe('VoicesService.listActive', () => {
  it('reads only active rows and only the public columns, ordered by sort order and then slug', async () => {
    const { service, findMany } = makeService([]);
    await service.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { slug: true, name: true, description: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  });

  it('returns slug, name and description only, in the shape of the response schema', async () => {
    const { service } = makeService([
      { slug: 'maxim', name: 'Максим', description: 'спокойный, размеренный' },
      { slug: 'anna', name: 'Анна', description: 'тёплый, нежный' },
    ]);
    const result = await service.listActive();
    expect(VoicesResponseSchema.parse(result)).toEqual({
      voices: [
        { slug: 'maxim', name: 'Максим', description: 'спокойный, размеренный' },
        { slug: 'anna', name: 'Анна', description: 'тёплый, нежный' },
      ],
    });
  });

  it('returns an empty list when nothing is active', async () => {
    const { service } = makeService([]);
    expect(await service.listActive()).toEqual({ voices: [] });
  });
});
