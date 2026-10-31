import { TopicsQuerySchema } from '@sleep-stories/contracts';
import {
  DEFAULT_FILTER,
  STYLE_CHIPS,
  filterFromParams,
  readyParamRequested,
  toggleReady,
  topicsPath,
  topicsQuery,
  withStyle,
} from './topic-filter';

describe('topic filter', () => {
  it('sends nothing for the default filter', () => {
    expect(topicsQuery(DEFAULT_FILTER)).toEqual({});
    expect(topicsPath(DEFAULT_FILTER)).toBe('/topics');
  });

  it('sends the style and the text "true" for ready', () => {
    const filter = toggleReady(withStyle(DEFAULT_FILTER, 'fairy_tale'));
    expect(topicsQuery(filter)).toEqual({ style: 'fairy_tale', ready: 'true' });
    expect(topicsPath(filter)).toBe('/topics?style=fairy_tale&ready=true');
  });

  it('never sends ready=false and keeps the query inside the contract', () => {
    const filter = toggleReady(toggleReady(withStyle(DEFAULT_FILTER, 'facts')));
    expect(topicsQuery(filter)).toEqual({ style: 'facts' });
    for (const style of [null, 'facts', 'fairy_tale', 'history'] as const) {
      for (const readyOnly of [false, true]) {
        expect(TopicsQuerySchema.safeParse(topicsQuery({ style, readyOnly })).success).toBe(true);
      }
    }
  });

  it('does not change the filter it is given', () => {
    const before = { ...DEFAULT_FILTER };
    toggleReady(DEFAULT_FILTER);
    withStyle(DEFAULT_FILTER, 'history');
    expect(DEFAULT_FILTER).toEqual(before);
  });

  it('offers «Все» first and every style once', () => {
    expect(STYLE_CHIPS.map((chip) => chip.style)).toEqual([null, 'facts', 'fairy_tale', 'history']);
    expect(STYLE_CHIPS[0].label).toBe('Все');
  });

  it('reads the preset from the route parameter', () => {
    expect(filterFromParams('1')).toEqual({ style: null, readyOnly: true });
    expect(filterFromParams(['1', '0'])).toEqual({ style: null, readyOnly: true });
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
