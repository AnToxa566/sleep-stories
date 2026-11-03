import {
  LISTEN_FINISHED_SHARE,
  LISTEN_MIN_SEC,
  LISTEN_REPORT_MAX_SEC,
  ListenReportRequestSchema,
  ListenReportResponseSchema,
} from './listens';

const storyId = '00000000-0000-4000-8000-000000000001';

describe('ListenReportRequestSchema', () => {
  it('keeps the minimum at 10 seconds', () => {
    expect(LISTEN_MIN_SEC).toBe(10);
  });

  it('keeps the finished share at 0.9', () => {
    expect(LISTEN_FINISHED_SHARE).toBe(0.9);
  });

  it.each([0, 1, 5, 600, LISTEN_REPORT_MAX_SEC])('accepts %d seconds', (listenedSec) => {
    expect(ListenReportRequestSchema.safeParse({ storyId, listenedSec }).success).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN, Infinity, LISTEN_REPORT_MAX_SEC + 1, '10', null])(
    'rejects %j seconds',
    (listenedSec) => {
      expect(ListenReportRequestSchema.safeParse({ storyId, listenedSec }).success).toBe(false);
    },
  );

  it('rejects a story id that is not a uuid or is missing', () => {
    expect(ListenReportRequestSchema.safeParse({ storyId: 'x', listenedSec: 10 }).success).toBe(
      false,
    );
    expect(ListenReportRequestSchema.safeParse({ listenedSec: 10 }).success).toBe(false);
  });

  it('rejects a user id, a voice or any other extra key', () => {
    for (const extra of [{ userId: storyId }, { voiceId: storyId }, { voice: 'anna' }]) {
      expect(
        ListenReportRequestSchema.safeParse({ storyId, listenedSec: 10, ...extra }).success,
      ).toBe(false);
    }
  });
});

describe('ListenReportResponseSchema', () => {
  it('accepts a boolean flag', () => {
    expect(ListenReportResponseSchema.safeParse({ recorded: true }).success).toBe(true);
    expect(ListenReportResponseSchema.safeParse({ recorded: false }).success).toBe(true);
  });

  it('rejects a missing flag and extra keys', () => {
    expect(ListenReportResponseSchema.safeParse({}).success).toBe(false);
    expect(ListenReportResponseSchema.safeParse({ recorded: true, id: 'x' }).success).toBe(false);
  });
});
