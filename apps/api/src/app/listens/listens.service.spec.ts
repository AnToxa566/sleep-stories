import { NotFoundException } from '@nestjs/common';
import { LISTEN_MIN_SEC } from '@sleep-stories/contracts';
import { lockUserRow } from '../prisma/lock-user-row';
import { LISTEN_DURATION_SLACK_SEC, ListensService } from './listens.service';

jest.mock('../prisma/lock-user-row', () => ({ lockUserRow: jest.fn() }));
const lockMock = lockUserRow as jest.Mock;

const USER = '00000000-0000-4000-8000-000000000001';
const STORY = '00000000-0000-4000-8000-000000000002';
const VOICE = '00000000-0000-4000-8000-000000000003';

function build(
  options: {
    preference?: { voiceId: string } | null;
    audio?: { durationSec: number } | null;
  } = {},
) {
  const tx = {
    listen: { create: jest.fn().mockResolvedValue({}) },
    queueItem: { deleteMany: jest.fn(), updateMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    userPreference: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.preference === undefined ? { voiceId: VOICE } : options.preference),
    },
    storyAudio: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.audio === undefined ? { durationSec: 600 } : options.audio,
        ),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new ListensService(prisma as never), prisma, tx };
}

describe('ListensService', () => {
  beforeEach(() => {
    lockMock.mockReset();
    lockMock.mockResolvedValue(true);
  });

  it('reads the voice from the preferences and looks the audio up by story and that voice', async () => {
    const { service, prisma } = build();
    await service.report(USER, { storyId: STORY, listenedSec: 100 });
    expect(prisma.userPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER } }),
    );
    expect(prisma.storyAudio.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storyId_voiceId: { storyId: STORY, voiceId: VOICE } } }),
    );
  });

  it('records the listen under the user lock and leaves the queue alone', async () => {
    const { service, tx } = build();
    await expect(service.report(USER, { storyId: STORY, listenedSec: 100 })).resolves.toEqual({
      recorded: true,
    });
    expect(lockMock).toHaveBeenCalledWith(tx, USER);
    expect(tx.listen.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        storyId: STORY,
        voiceId: VOICE,
        listenedSec: 100,
        listenedAt: expect.any(Date),
      }),
    });
    expect(tx.queueItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.queueItem.updateMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('writes nothing below the minimum and leaves the queue alone', async () => {
    const { service, prisma } = build();
    await expect(
      service.report(USER, { storyId: STORY, listenedSec: LISTEN_MIN_SEC - 1 }),
    ).resolves.toEqual({ recorded: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records a listen of exactly the minimum', async () => {
    const { service, tx } = build();
    await expect(
      service.report(USER, { storyId: STORY, listenedSec: LISTEN_MIN_SEC }),
    ).resolves.toEqual({ recorded: true });
    expect(tx.listen.create).toHaveBeenCalledTimes(1);
  });

  it('clamps the reported seconds to the audio duration plus the slack', async () => {
    const { service, tx } = build();
    await service.report(USER, { storyId: STORY, listenedSec: 2_000_000 });
    expect(tx.listen.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ listenedSec: 600 + LISTEN_DURATION_SLACK_SEC }),
    });
  });

  it('gives one 404 for no preferences and for no audio in the voice, and writes nothing', async () => {
    for (const options of [{ preference: null }, { audio: null }]) {
      const { service, prisma } = build(options);
      const error = await service
        .report(USER, { storyId: STORY, listenedSec: 100 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ statusCode: 404, message: 'Story not available' }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('answers 404 and writes nothing when the users row is gone', async () => {
    lockMock.mockResolvedValue(false);
    const { service, tx } = build();
    await expect(service.report(USER, { storyId: STORY, listenedSec: 100 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.listen.create).not.toHaveBeenCalled();
  });
});
