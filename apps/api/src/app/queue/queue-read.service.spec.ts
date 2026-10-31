import { QueueReadService } from './queue-read.service';
import { QUEUE_AUDIO_URL_TTL_SECONDS } from './queue-policy';
import * as storyState from './story-state';
import type { StoryState } from './story-state';

jest.mock('./story-state', () => ({
  ...jest.requireActual('./story-state'),
  readStoryStates: jest.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const readStates = storyState.readStoryStates as jest.Mock;

function row(n: number) {
  return { id: id(n), topicId: id(100 + n), topic: { title: `Тема ${n}`, style: 'facts' as const } };
}
const ready = (n: number): StoryState => ({
  state: 'ready',
  storyId: id(200 + n),
  durationSec: 600 + n,
  storagePath: `stories/secret-${n}/anna.mp3`,
});
const plain = (state: 'creating' | 'failed' | 'not_ready'): StoryState => ({
  state,
  storyId: null,
  durationSec: null,
  storagePath: null,
});

function build(options: { preferences?: { voiceId: string } | null; rows?: ReturnType<typeof row>[] }) {
  const prisma = {
    userPreference: {
      findUnique: jest.fn().mockResolvedValue(
        options.preferences === undefined ? { voiceId: id(900) } : options.preferences,
      ),
    },
    queueItem: { findMany: jest.fn().mockResolvedValue(options.rows ?? []) },
  };
  const limits = { usage: jest.fn().mockResolvedValue({ generationsUsed: 2, suggestionsUsed: 0 }) };
  const signMany = jest
    .fn()
    .mockImplementation(async (paths: string[]) =>
      paths.map((_path, index) => `https://signed.example.test/opaque-${index}`),
    );
  const service = new QueueReadService(prisma as never, limits as never, { signMany } as never);
  return { service, prisma, limits, signMany };
}

beforeEach(() => readStates.mockReset());

describe('QueueReadService.read', () => {
  it('returns an empty queue and the full allowance when there are no preferences', async () => {
    const { service, prisma, limits, signMany } = build({ preferences: null });
    await expect(service.read(id(1))).resolves.toEqual({
      items: [],
      generations: { left: 5, limit: 5 },
    });
    expect(prisma.queueItem.findMany).not.toHaveBeenCalled();
    expect(limits.usage).not.toHaveBeenCalled();
    expect(signMany).not.toHaveBeenCalled();
  });

  it('scopes the queue by the user id and orders by position, created_at, id', async () => {
    const { service, prisma } = build({ rows: [] });
    await service.read(id(1));
    expect(prisma.queueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: id(1) },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('does not sign anything when no item is ready', async () => {
    const { service, signMany } = build({ rows: [row(1), row(2)] });
    readStates.mockResolvedValue(
      new Map([
        [id(101), plain('creating')],
        [id(102), plain('failed')],
      ]),
    );
    const result = await service.read(id(1));
    expect(signMany).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.state)).toEqual(['creating', 'failed']);
  });

  it('signs all ready paths in one call and matches the URLs back by index', async () => {
    const { service, signMany } = build({ rows: [row(1), row(2), row(3), row(4)] });
    readStates.mockResolvedValue(
      new Map<string, StoryState>([
        [id(101), ready(1)],
        [id(102), plain('not_ready')],
        [id(103), ready(3)],
        [id(104), plain('creating')],
      ]),
    );
    const result = await service.read(id(1));
    expect(signMany).toHaveBeenCalledTimes(1);
    expect(signMany).toHaveBeenCalledWith(
      ['stories/secret-1/anna.mp3', 'stories/secret-3/anna.mp3'],
      QUEUE_AUDIO_URL_TTL_SECONDS,
    );
    expect(result.items[0]).toEqual({
      id: id(1),
      topicId: id(101),
      title: 'Тема 1',
      style: 'facts',
      state: 'ready',
      storyId: id(201),
      durationSec: 601,
      audioUrl: 'https://signed.example.test/opaque-0',
    });
    expect(result.items[2]).toMatchObject({ state: 'ready', audioUrl: 'https://signed.example.test/opaque-1' });
    expect(result.items[1]).toEqual({
      id: id(2),
      topicId: id(102),
      title: 'Тема 2',
      style: 'facts',
      state: 'not_ready',
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-|stories\//);
  });

  it('reports the allowance left from the usage', async () => {
    const { service, limits } = build({ rows: [] });
    const result = await service.read(id(1));
    expect(limits.usage).toHaveBeenCalledWith(expect.anything(), id(1));
    expect(result.generations).toEqual({ left: 3, limit: 5 });
  });

  it('fails when the storage returns a different number of URLs', async () => {
    const { service, signMany } = build({ rows: [row(1)] });
    readStates.mockResolvedValue(new Map([[id(101), ready(1)]]));
    signMany.mockResolvedValue([]);
    await expect(service.read(id(1))).rejects.toThrow();
  });
});
