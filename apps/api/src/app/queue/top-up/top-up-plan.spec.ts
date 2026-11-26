import { planTopUp, type TopUpPlanInput } from './top-up-plan';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

const base: TopUpPlanInput = {
  queueLength: 0,
  suggestionsLeft: 3,
  ready: [],
  withoutAudio: [],
  withoutStory: [],
};

const plan = (over: Partial<TopUpPlanInput>) => planTopUp({ ...base, ...over });

describe('planTopUp', () => {
  describe('need', () => {
    it.each([
      [0, 3],
      [1, 2],
      [2, 1],
      [3, 0],
      [4, 0],
      [10, 0],
      [-5, 3],
    ])('queue length %d needs %d', (queueLength, need) => {
      expect(plan({ queueLength }).need).toBe(need);
    });

    it('does nothing at all when the queue is above the threshold', () => {
      expect(
        plan({
          queueLength: 3,
          ready: ids('r', 3),
          withoutAudio: ids('d', 3),
          withoutStory: ids('w', 3),
        }),
      ).toEqual({
        need: 0,
        queueReady: [],
        queueWithoutAudio: [],
        queueWithoutStory: [],
        suggestMissing: 0,
      });
    });

    it('asks for one when the queue holds exactly two', () => {
      const result = plan({ queueLength: 2, ready: ids('r', 3) });
      expect(result.need).toBe(1);
      expect(result.queueReady).toEqual(['r1']);
    });
  });

  describe('each source alone', () => {
    it('takes ready ids', () => {
      const result = plan({ ready: ids('r', 3), suggestionsLeft: 0 });
      expect(result.queueReady).toEqual(['r1', 'r2', 'r3']);
      expect(result.queueWithoutAudio).toEqual([]);
      expect(result.queueWithoutStory).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes ids with no audio in the voice', () => {
      const result = plan({ withoutAudio: ids('d', 3) });
      expect(result.queueWithoutAudio).toEqual(['d1', 'd2', 'd3']);
      expect(result.queueReady).toEqual([]);
      expect(result.queueWithoutStory).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes own topics with no story', () => {
      const result = plan({ withoutStory: ids('w', 2), queueLength: 1 });
      expect(result.queueWithoutStory).toEqual(['w1', 'w2']);
      expect(result.queueReady).toEqual([]);
      expect(result.queueWithoutAudio).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });
  });

  describe('source order', () => {
    it('takes ready, then no-audio, then no-story', () => {
      const result = plan({ ready: ['r1'], withoutAudio: ['d1'], withoutStory: ['w1', 'w2'] });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueWithoutAudio).toEqual(['d1']);
      expect(result.queueWithoutStory).toEqual(['w1']);
      expect(result.suggestMissing).toBe(0);
    });

    it('lets no-audio use the need before no-story', () => {
      const result = plan({ ready: ['r1'], withoutAudio: ids('d', 3), withoutStory: ['w1'] });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueWithoutAudio).toEqual(['d1', 'd2']);
      expect(result.queueWithoutStory).toEqual([]);
    });
  });

  describe('suggestions', () => {
    it('is capped at 3 even when the need is larger', () => {
      // The cap is MAX_SUGGESTED_PER_JOB; the largest need today is 3, so this pins the
      // behaviour for an empty queue and no candidates.
      expect(plan({}).suggestMissing).toBe(3);
    });

    it('asks only for what is still missing after the lists', () => {
      expect(plan({ ready: ['r1'] }).suggestMissing).toBe(2);
    });

    it('asks for one when the queue holds two and nothing fits', () => {
      expect(plan({ queueLength: 2 }).suggestMissing).toBe(1);
    });

    it('is 0 when no suggestion slot is left', () => {
      expect(plan({ suggestionsLeft: 0 }).suggestMissing).toBe(0);
    });

    it('needs only a suggestion slot: no generation input exists to block it', () => {
      expect(Object.keys(base)).not.toContain('generationsLeft');
      expect(plan({ suggestionsLeft: 1 }).suggestMissing).toBe(3);
    });

    it('is never above the need', () => {
      for (let queueLength = 0; queueLength <= 4; queueLength++) {
        for (let ready = 0; ready <= 4; ready++) {
          const result = plan({ queueLength, ready: ids('r', ready) });
          expect(result.suggestMissing).toBeLessThanOrEqual(result.need);
        }
      }
    });

    it('is 0 when the lists already cover the need', () => {
      expect(plan({ ready: ids('r', 3) }).suggestMissing).toBe(0);
    });
  });

  describe('the total never exceeds the need', () => {
    it.each([
      [0, 10, 10, 10],
      [1, 10, 10, 10],
      [2, 10, 10, 10],
      [2, 1, 0, 0],
      [0, 2, 2, 2],
    ])('queue %d with lists of %d/%d/%d', (queueLength, r, d, w) => {
      const result = plan({
        queueLength,
        ready: ids('r', r),
        withoutAudio: ids('d', d),
        withoutStory: ids('w', w),
      });
      const total =
        result.queueReady.length +
        result.queueWithoutAudio.length +
        result.queueWithoutStory.length;
      expect(total).toBeLessThanOrEqual(result.need);
    });
  });

  describe('defensive inputs', () => {
    it('treats a negative suggestion count as 0', () => {
      const result = plan({ suggestionsLeft: -1, ready: ['r1'] });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.suggestMissing).toBe(0);
    });
  });
});
