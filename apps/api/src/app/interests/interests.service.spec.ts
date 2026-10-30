import { InterestsResponseSchema } from '@sleep-stories/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { InterestsService } from './interests.service';

function makeService(rows: { slug: string; title: string }[]) {
  const findMany = jest.fn(async () => rows);
  const prisma = { interest: { findMany } };
  return { service: new InterestsService(prisma as unknown as PrismaService), findMany };
}

describe('InterestsService.listActive', () => {
  it('reads only active rows, ordered by sort order and then slug', async () => {
    const { service, findMany } = makeService([]);
    await service.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { slug: true, title: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  });

  it('returns slug and title only, in the shape of the response schema', async () => {
    const { service } = makeService([
      { slug: 'history', title: 'История' },
      { slug: 'space', title: 'Космос' },
    ]);
    const result = await service.listActive();
    expect(InterestsResponseSchema.parse(result)).toEqual({
      interests: [
        { slug: 'history', title: 'История' },
        { slug: 'space', title: 'Космос' },
      ],
    });
  });

  it('returns an empty list when nothing is active', async () => {
    const { service } = makeService([]);
    expect(await service.listActive()).toEqual({ interests: [] });
  });
});
