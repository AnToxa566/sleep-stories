import { planTopUp, type TopUpPlanInput } from './top-up-plan';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

const base: TopUpPlanInput = {
  queueLength: 0,
  rendersLeft: 5,
  suggestionsLeft: 3,
  ready: [],
  rendering: [],
  writing: [],
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
          rendering: ids('d', 3),
          writing: ids('w', 3),
        }),
      ).toEqual({
        need: 0,
        queueReady: [],
        queueRendering: [],
        queueWriting: [],
        suggestMissing: 0,
      });
    });

    it('asks for one when the queue holds exactly two', () => {
      const result = plan({ queueLength: 2, ready: ids('r', 3) });
      expect(result.need).toBe(1);
      expect(result.queueReady).toEqual(['r1']);
    });
  });

  describe('each tier alone', () => {
    it('takes ready ids with no render slot', () => {
      const result = plan({
        ready: ids('r', 3),
        rendersLeft: 0,
        suggestionsLeft: 0,
      });
      expect(result.queueReady).toEqual(['r1', 'r2', 'r3']);
      expect(result.queueRendering).toEqual([]);
      expect(result.queueWriting).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes rendering ids', () => {
      const result = plan({ rendering: ids('d', 3) });
      expect(result.queueRendering).toEqual(['d1', 'd2', 'd3']);
      expect(result.queueReady).toEqual([]);
      expect(result.queueWriting).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes writing ids', () => {
      const result = plan({ writing: ids('w', 2), queueLength: 1 });
      expect(result.queueWriting).toEqual(['w1', 'w2']);
      expect(result.queueReady).toEqual([]);
      expect(result.queueRendering).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });
  });

  describe('tier order', () => {
    it('takes ready, then rendering, then writing when slots are plentiful', () => {
      const result = plan({
        ready: ['r1'],
        rendering: ['d1'],
        writing: ['w1', 'w2'],
      });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueRendering).toEqual(['d1']);
      expect(result.queueWriting).toEqual(['w1']);
      expect(result.suggestMissing).toBe(0);
    });

    it('lets rendering use the need before writing', () => {
      const result = plan({
        ready: ['r1'],
        rendering: ids('d', 3),
        writing: ['w1'],
      });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueRendering).toEqual(['d1', 'd2']);
      expect(result.queueWriting).toEqual([]);
    });

    it('lets rendering and writing share the render slots', () => {
      const result = plan({
        rendersLeft: 2,
        rendering: ids('d', 1),
        writing: ids('w', 3),
      });
      expect(result.queueRendering).toEqual(['d1']);
      expect(result.queueWriting).toEqual(['w1']);
      // No render slot is left, so no suggestion for the one still missing.
      expect(result.suggestMissing).toBe(0);
    });
  });

  describe('the daily render limit (through rendersLeft)', () => {
    it('allows one render item when four of five are used and none is active', () => {
      const result = plan({ rendersLeft: 1, rendering: ids('d', 2) });
      expect(result.queueRendering).toEqual(['d1']);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes ready but nothing else when four are used and one is active', () => {
      const result = plan({
        rendersLeft: 0,
        ready: ['r1'],
        rendering: ids('d', 2),
        writing: ids('w', 2),
      });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueRendering).toEqual([]);
      expect(result.queueWriting).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });

    it('takes nothing but ready when three are used and two are active', () => {
      const result = plan({
        rendersLeft: 0,
        ready: ['r1', 'r2'],
        rendering: ['d1'],
        writing: ['w1'],
      });
      expect(result.queueReady).toEqual(['r1', 'r2']);
      expect(result.queueRendering).toEqual([]);
      expect(result.queueWriting).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });
  });

  describe('suggestions', () => {
    it('is capped at 3 even when the need is larger', () => {
      // The cap is MAX_SUGGESTED_PER_JOB; the largest need today is 3, so this pins the
      // behaviour for an empty queue and no candidates.
      expect(plan({}).suggestMissing).toBe(3);
    });

    it('asks only for what is still missing after the lists', () => {
      const result = plan({ ready: ['r1'] });
      expect(result.suggestMissing).toBe(2);
    });

    it('asks for one when the queue holds two and nothing fits', () => {
      expect(plan({ queueLength: 2 }).suggestMissing).toBe(1);
    });

    it('is 0 when no suggestion slot is left', () => {
      expect(plan({ suggestionsLeft: 0 }).suggestMissing).toBe(0);
    });

    it('is 0 when no render slot is left, even with 3 suggestions left', () => {
      expect(plan({ rendersLeft: 0, suggestionsLeft: 3 }).suggestMissing).toBe(0);
    });

    it('is 0 when the render slots are all used by the lists', () => {
      const result = plan({ rendersLeft: 1, rendering: ['d1'] });
      expect(result.queueRendering).toEqual(['d1']);
      expect(result.suggestMissing).toBe(0);
    });

    it('is asked when a render slot stays unused after the lists', () => {
      const result = plan({ rendersLeft: 2, rendering: ['d1'] });
      expect(result.suggestMissing).toBe(2);
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
      [0, 10, 10, 10, 10],
      [1, 10, 10, 10, 10],
      [2, 10, 10, 10, 10],
      [2, 1, 0, 0, 1],
      [0, 2, 2, 2, 3],
    ])(
      'queue %d with lists of %d/%d/%d and %d render slots',
      (queueLength, r, d, w, rendersLeft) => {
        const result = plan({
          queueLength,
          rendersLeft,
          ready: ids('r', r),
          rendering: ids('d', d),
          writing: ids('w', w),
        });
        const total =
          result.queueReady.length + result.queueRendering.length + result.queueWriting.length;
        expect(total).toBeLessThanOrEqual(result.need);
        expect(result.queueRendering.length + result.queueWriting.length).toBeLessThanOrEqual(
          rendersLeft,
        );
      },
    );
  });

  describe('defensive inputs', () => {
    it('treats negative slots as 0', () => {
      const result = plan({
        rendersLeft: -2,
        suggestionsLeft: -1,
        ready: ['r1'],
        rendering: ['d1'],
      });
      expect(result.queueReady).toEqual(['r1']);
      expect(result.queueRendering).toEqual([]);
      expect(result.suggestMissing).toBe(0);
    });
  });
});
