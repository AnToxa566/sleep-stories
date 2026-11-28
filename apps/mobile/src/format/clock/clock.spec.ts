import { formatClock } from './clock';

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 10, 23, 2, 4))).toBe('02:04');
    expect(formatClock(new Date(2026, 10, 23, 23, 59))).toBe('23:59');
  });
});
