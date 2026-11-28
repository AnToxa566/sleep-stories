import { queueAllowance } from './queue-allowance';

const first = new Date('2026-11-28T09:30:00.123Z');
const last = new Date('2026-11-28T21:05:00.000Z');

describe('queueAllowance', () => {
  it('gives the full allowance and no times when nothing is counted', () => {
    expect(
      queueAllowance({ generationsUsed: 0, activeCount: 0, firstBackAt: null, lastBackAt: null }),
    ).toEqual({ left: 5, limit: 5, nextAt: null, fullAt: null });
  });

  it('gives both times, as ISO strings, when only successes are counted', () => {
    expect(
      queueAllowance({ generationsUsed: 2, activeCount: 0, firstBackAt: first, lastBackAt: last }),
    ).toEqual({
      left: 3,
      limit: 5,
      nextAt: '2026-11-28T09:30:00.123Z',
      fullAt: '2026-11-28T21:05:00.000Z',
    });
  });

  it('gives no times while only active generations hold slots', () => {
    expect(
      queueAllowance({ generationsUsed: 2, activeCount: 2, firstBackAt: null, lastBackAt: null }),
    ).toEqual({ left: 3, limit: 5, nextAt: null, fullAt: null });
  });

  it('keeps nextAt and drops fullAt when successes and active generations are mixed', () => {
    expect(
      queueAllowance({ generationsUsed: 3, activeCount: 1, firstBackAt: first, lastBackAt: last }),
    ).toEqual({ left: 2, limit: 5, nextAt: '2026-11-28T09:30:00.123Z', fullAt: null });
  });

  it('never reports fewer than zero left', () => {
    expect(
      queueAllowance({ generationsUsed: 7, activeCount: 0, firstBackAt: first, lastBackAt: last }),
    ).toMatchObject({ left: 0, limit: 5 });
  });
});
