import type { QueueItem } from '@sleep-stories/contracts';
import { estimateProgress, nextCollectingSince, nextCreatingSince, PROGRESS_CAP } from './progress';

const ID = '00000000-0000-4000-8000-000000000001';
const item = (state: 'creating' | 'not_ready'): QueueItem => ({
  id: ID,
  topicId: ID,
  title: 'Тема',
  style: 'facts',
  heard: false,
  state,
});

describe('estimateProgress', () => {
  it('starts at zero and never goes below it', () => {
    expect(estimateProgress(1000, 1000)).toBe(0);
    expect(estimateProgress(1000, 0)).toBe(0);
    expect(estimateProgress(Number.NaN, 1000)).toBe(0);
  });

  it('rises monotonically and stays under the cap', () => {
    let previous = 0;
    for (let seconds = 1; seconds <= 3600; seconds += 7) {
      const value = estimateProgress(0, seconds * 1000);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(PROGRESS_CAP);
      previous = value;
    }
    expect(PROGRESS_CAP).toBe(0.92);
    expect(estimateProgress(0, 10 * 3600 * 1000)).toBeCloseTo(PROGRESS_CAP, 5);
  });

  it('is well on its way after the promised ~2 minutes', () => {
    const value = estimateProgress(0, 120_000);
    expect(value).toBeGreaterThan(0.7);
    expect(value).toBeLessThan(PROGRESS_CAP);
  });
});

describe('nextCreatingSince', () => {
  it('starts when a creating item first appears and keeps the earlier time', () => {
    expect(nextCreatingSince(null, [item('creating')], 500)).toBe(500);
    expect(nextCreatingSince(200, [item('creating')], 500)).toBe(200);
  });

  it('resets when nothing is creating', () => {
    expect(nextCreatingSince(200, [item('not_ready')], 500)).toBeNull();
    expect(nextCreatingSince(null, [], 500)).toBeNull();
  });
});

describe('nextCollectingSince', () => {
  it('starts when collecting is first seen, keeps the time, resets when it stops', () => {
    expect(nextCollectingSince(null, true, 500)).toBe(500);
    expect(nextCollectingSince(500, true, 900)).toBe(500);
    expect(nextCollectingSince(500, false, 900)).toBeNull();
    expect(nextCollectingSince(null, false, 900)).toBeNull();
  });
});
