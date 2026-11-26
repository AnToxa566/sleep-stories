import {
  COLLECT_FAKE_MS,
  estimateProgress,
  GENERATION_FAKE_MS,
  nextSinceTrack,
  PROGRESS_CAP,
  PROGRESS_CREEP,
  SINCE_GRACE_MS,
  type SinceTrack,
} from './progress';

describe('estimateProgress', () => {
  it('uses the agreed durations and cap', () => {
    expect(GENERATION_FAKE_MS).toBe(180_000);
    expect(COLLECT_FAKE_MS).toBe(30_000);
    expect(PROGRESS_CAP).toBe(0.95);
  });

  it('starts at zero and bad input gives zero', () => {
    expect(estimateProgress(1000, 1000, 30_000)).toBe(0);
    expect(estimateProgress(1000, 0, 30_000)).toBe(0);
    expect(estimateProgress(Number.NaN, 1000, 30_000)).toBe(0);
    expect(estimateProgress(0, Number.POSITIVE_INFINITY, 30_000)).toBe(0);
    expect(estimateProgress(0, 1000, 0)).toBe(0);
    expect(estimateProgress(0, 1000, -5)).toBe(0);
    expect(estimateProgress(0, 1000, Number.NaN)).toBe(0);
  });

  it.each([COLLECT_FAKE_MS, GENERATION_FAKE_MS])(
    'is monotonic, near the cap at %i ms and never reaches 1',
    (duration) => {
      let previous = 0;
      for (let ms = 0; ms <= duration * 20; ms += duration / 100) {
        const value = estimateProgress(0, ms, duration);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThan(PROGRESS_CAP + PROGRESS_CREEP);
        previous = value;
      }
      expect(estimateProgress(0, duration, duration)).toBeCloseTo(PROGRESS_CAP, 6);
      expect(estimateProgress(0, duration * 1000, duration)).toBeLessThan(1);
      expect(estimateProgress(0, duration * 1000, duration)).toBeGreaterThan(PROGRESS_CAP);
    },
  );

  it('moves visibly all the way to the stated time (no stall after the first seconds)', () => {
    // Every quarter second in the last 20 s before the cap still gains something.
    const before = estimateProgress(0, GENERATION_FAKE_MS - 20_250, GENERATION_FAKE_MS);
    const after = estimateProgress(0, GENERATION_FAKE_MS - 20_000, GENERATION_FAKE_MS);
    expect(after).toBeGreaterThan(before);
    // The fill is already well on its way after a third of the time.
    expect(estimateProgress(0, GENERATION_FAKE_MS / 3, GENERATION_FAKE_MS)).toBeGreaterThan(0.5);
  });
});

describe('nextSinceTrack', () => {
  const track = (since: number, lastActive: number): SinceTrack => ({ since, lastActive });

  it('starts at the first sighting and keeps the earlier start while active', () => {
    expect(nextSinceTrack(null, true, 500)).toEqual({ since: 500, lastActive: 500 });
    expect(nextSinceTrack(track(200, 300), true, 900)).toEqual({ since: 200, lastActive: 900 });
  });

  it('keeps the start through a brief gap (a refetch or poll without the creating item)', () => {
    const gap = nextSinceTrack(track(200, 1000), false, 1000 + SINCE_GRACE_MS);
    expect(gap).toEqual(track(200, 1000));
    // ...and the same fill goes on when the item comes back.
    expect(nextSinceTrack(gap, true, 1000 + SINCE_GRACE_MS + 10)?.since).toBe(200);
  });

  it('starts over only after nothing was active for longer than the grace', () => {
    expect(nextSinceTrack(track(200, 1000), false, 1000 + SINCE_GRACE_MS + 1)).toBeNull();
    expect(nextSinceTrack(null, false, 5000)).toBeNull();
    const fresh = nextSinceTrack(null, true, 20_000);
    expect(fresh?.since).toBe(20_000);
  });

  it('does not reset a running fill after a long silence while still active (background)', () => {
    expect(nextSinceTrack(track(200, 300), true, 600_000)?.since).toBe(200);
  });
});
