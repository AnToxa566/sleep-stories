import { isSameSet } from './queue-order';

describe('isSameSet', () => {
  it('accepts the same ids in any order, and two empty lists', () => {
    expect(isSameSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isSameSet([], [])).toBe(true);
  });

  it('rejects a missing id, an extra id and a different id', () => {
    expect(isSameSet(['a', 'b'], ['a'])).toBe(false);
    expect(isSameSet(['a'], ['a', 'b'])).toBe(false);
    expect(isSameSet(['a', 'b'], ['a', 'x'])).toBe(false);
  });

  it('rejects a repeated id even when the length matches', () => {
    expect(isSameSet(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isSameSet(['a', 'a'], ['a', 'a'])).toBe(false);
  });
});
