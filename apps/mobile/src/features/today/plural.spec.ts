import { strings } from '../../strings';
import { formatDuration, formatPosition, pluralRu } from './plural';

const forms = strings.today.nouns.generation;

describe('pluralRu', () => {
  it.each([
    [0, 'генераций'],
    [1, 'генерация'],
    [2, 'генерации'],
    [4, 'генерации'],
    [5, 'генераций'],
    [11, 'генераций'],
    [12, 'генераций'],
    [14, 'генераций'],
    [21, 'генерация'],
    [22, 'генерации'],
    [25, 'генераций'],
    [101, 'генерация'],
    [111, 'генераций'],
  ])('declines %i', (n, expected) => {
    expect(pluralRu(n, forms)).toBe(expected);
  });

  it('declines the stories noun', () => {
    expect(pluralRu(3, strings.today.nouns.story)).toBe('истории');
    expect(pluralRu(1, strings.today.nouns.story)).toBe('история');
    expect(pluralRu(7, strings.today.nouns.story)).toBe('историй');
  });
});

describe('formatDuration', () => {
  it('writes m:ss', () => {
    expect(formatDuration(151)).toBe('2:31');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3725)).toBe('62:05');
  });

  it('rounds down and survives bad input', () => {
    expect(formatDuration(59.9)).toBe('0:59');
    expect(formatDuration(-3)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatPosition', () => {
  it('is one-based and padded', () => {
    expect(formatPosition(0)).toBe('01');
    expect(formatPosition(9)).toBe('10');
  });
});
