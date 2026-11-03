import { TopicsQuerySchema } from '@sleep-stories/contracts';
import {
  DEFAULT_FILTER,
  HEARD_OPTIONS,
  READY_OPTIONS,
  STYLE_CHIPS,
  filterFromParams,
  heardChipLabel,
  readyChipLabel,
  readyParamRequested,
  topicsPath,
  topicsQuery,
  withHeard,
  withReady,
  withStyle,
  type HeardFilter,
  type ReadyFilter,
} from './topic-filter';

describe('topic filter', () => {
  it('hides nothing and sends nothing for the default filter', () => {
    expect(DEFAULT_FILTER).toEqual({ style: null, ready: 'all', heard: 'all' });
    expect(topicsQuery(DEFAULT_FILTER)).toEqual({});
    expect(topicsPath(DEFAULT_FILTER)).toBe('/topics');
  });

  it('maps ready and heard to the text the server reads', () => {
    expect(topicsQuery(withReady(DEFAULT_FILTER, 'ready'))).toEqual({
      ready: 'true',
    });
    expect(topicsQuery(withReady(DEFAULT_FILTER, 'not'))).toEqual({
      ready: 'false',
    });
    expect(topicsQuery(withHeard(DEFAULT_FILTER, 'new'))).toEqual({
      heard: 'false',
    });
    expect(topicsQuery(withHeard(DEFAULT_FILTER, 'heard'))).toEqual({
      heard: 'true',
    });
  });

  it('builds the request path in the order style, ready, heard', () => {
    const filter = withHeard(withReady(withStyle(DEFAULT_FILTER, 'fairy_tale'), 'ready'), 'new');
    expect(topicsPath(filter)).toBe('/topics?style=fairy_tale&ready=true&heard=false');
    expect(topicsPath(withHeard(DEFAULT_FILTER, 'heard'))).toBe('/topics?heard=true');
  });

  it('resets a choice with «Все» and keeps the query inside the contract', () => {
    expect(topicsQuery(withReady(withReady(DEFAULT_FILTER, 'not'), 'all'))).toEqual({});
    for (const style of [null, 'facts', 'fairy_tale', 'history'] as const) {
      for (const ready of ['all', 'ready', 'not'] as const) {
        for (const heard of ['all', 'new', 'heard'] as const) {
          const query = topicsQuery({ style, ready, heard });
          expect(TopicsQuerySchema.safeParse(query).success).toBe(true);
        }
      }
    }
  });

  it('does not change the filter it is given', () => {
    const before = { ...DEFAULT_FILTER };
    withReady(DEFAULT_FILTER, 'ready');
    withHeard(DEFAULT_FILTER, 'heard');
    withStyle(DEFAULT_FILTER, 'history');
    expect(DEFAULT_FILTER).toEqual(before);
  });

  it('offers «Все» first in each sheet and every choice once', () => {
    expect(READY_OPTIONS.map((option) => option.value)).toEqual(['all', 'ready', 'not']);
    expect(READY_OPTIONS.map((option) => option.label)).toEqual([
      'Все',
      'Только готовые',
      'Только неготовые',
    ]);
    expect(HEARD_OPTIONS.map((option) => option.value)).toEqual(['all', 'new', 'heard']);
    expect(HEARD_OPTIONS.map((option) => option.label)).toEqual([
      'Все',
      'Только непрослушанные',
      'Только прослушанные',
    ]);
  });

  it('shows the name of a chip while off and the short choice while on', () => {
    const ready: ReadyFilter[] = ['all', 'ready', 'not'];
    const heard: HeardFilter[] = ['all', 'new', 'heard'];
    expect(ready.map(readyChipLabel)).toEqual(['Готовность', 'Готовые', 'Неготовые']);
    expect(heard.map(heardChipLabel)).toEqual(['Прослушивание', 'Непрослушанные', 'Прослушанные']);
  });

  it('offers «Все» first and every style once', () => {
    expect(STYLE_CHIPS.map((chip) => chip.style)).toEqual([null, 'facts', 'fairy_tale', 'history']);
    expect(STYLE_CHIPS[0].label).toBe('Все');
  });

  it('reads the preset from the route parameter', () => {
    expect(filterFromParams('1')).toEqual({
      ...DEFAULT_FILTER,
      ready: 'ready',
    });
    expect(filterFromParams(['1', '0'])).toEqual({
      ...DEFAULT_FILTER,
      ready: 'ready',
    });
    expect(filterFromParams(undefined)).toEqual(DEFAULT_FILTER);
    expect(filterFromParams('true')).toEqual(DEFAULT_FILTER);
    expect(filterFromParams([])).toEqual(DEFAULT_FILTER);
  });

  it('asks for «Готовые» only with ready=1, once cleared it asks for nothing', () => {
    expect(readyParamRequested('1')).toBe(true);
    expect(readyParamRequested(['1'])).toBe(true);
    expect(readyParamRequested(undefined)).toBe(false);
    expect(readyParamRequested('')).toBe(false);
    expect(readyParamRequested('0')).toBe(false);
    expect(readyParamRequested([])).toBe(false);
  });
});
