import type { QueueItem } from '@sleep-stories/contracts';
import { itemIds, moveItem, removeItem, replacedTitle, titleOf } from './queue-edit';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mk = (n: number, topic = n, title = `Тема ${topic}`): QueueItem => ({
  id: id(n),
  topicId: id(100 + topic),
  title,
  style: 'facts',
  heard: false,
  state: 'not_ready',
});

describe('moveItem', () => {
  it('moves forward and backward without mutating the input', () => {
    const list = [1, 2, 3, 4];
    expect(moveItem(list, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(list, 3, 1)).toEqual([1, 4, 2, 3]);
    expect(list).toEqual([1, 2, 3, 4]);
  });

  it('returns an unchanged copy for equal or out-of-range indices', () => {
    const list = [1, 2, 3];
    for (const [from, to] of [[1, 1], [-1, 0], [0, 3], [5, 1], [0.5, 1]]) {
      const result = moveItem(list, from, to);
      expect(result).toEqual(list);
      expect(result).not.toBe(list);
    }
  });
});

describe('removeItem', () => {
  it('drops the item and keeps the order', () => {
    const list = [mk(1), mk(2), mk(3)];
    expect(removeItem(list, id(2)).map((i) => i.id)).toEqual([id(1), id(3)]);
    expect(list).toHaveLength(3);
  });

  it('returns an unchanged copy for an unknown id', () => {
    const list = [mk(1)];
    const result = removeItem(list, id(9));
    expect(result).toEqual(list);
    expect(result).not.toBe(list);
  });
});

describe('itemIds', () => {
  it('lists ids in order, as the reorder request wants', () => {
    expect(itemIds([mk(2), mk(1)])).toEqual([id(2), id(1)]);
  });
});

describe('replacedTitle', () => {
  it('returns the new title of the item that kept its id', () => {
    const before = [mk(1), mk(2, 2, 'Старая')];
    const after = [mk(1), mk(2, 7, 'Лис и звёздная карта')];
    expect(replacedTitle(before, after, id(2))).toBe('Лис и звёздная карта');
  });

  it('returns null when the topic did not change or the item is gone', () => {
    const before = [mk(1), mk(2)];
    expect(replacedTitle(before, before, id(2))).toBeNull();
    expect(replacedTitle(before, [mk(1)], id(2))).toBeNull();
    expect(replacedTitle([mk(1)], before, id(2))).toBeNull();
  });
});

describe('titleOf', () => {
  it('finds a title by item id', () => {
    expect(titleOf([mk(1, 1, 'Сова')], id(1))).toBe('Сова');
    expect(titleOf([mk(1)], id(2))).toBeNull();
  });
});
