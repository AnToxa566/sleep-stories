import { queueQueryKey } from './query-keys';

describe('queueQueryKey', () => {
  it('separates accounts', () => {
    expect(queueQueryKey('a')).toEqual(['queue', 'a']);
    expect(queueQueryKey('a')).not.toEqual(queueQueryKey('b'));
  });
});
