import type { StoryStyle, TopicsQuery } from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../strings';

// The filter of «Темы» and «Замена»: one style or all, a readiness choice and a heard choice.
// Pure; no React Native. The server does the filtering (GET /topics?style=&ready=&heard=), so
// the filter is also the key of the cached list. Nothing is hidden by default: «Все» sends nothing.

export type ReadyFilter = 'all' | 'ready' | 'not';
export type HeardFilter = 'all' | 'new' | 'heard';

export type TopicFilter = {
  // null is «Все».
  readonly style: StoryStyle | null;
  readonly ready: ReadyFilter;
  readonly heard: HeardFilter;
};

export const DEFAULT_FILTER: TopicFilter = {
  style: null,
  ready: 'all',
  heard: 'all',
};

export type StyleChip = {
  readonly style: StoryStyle | null;
  readonly label: string;
};

// «Все», «Факты», «Сказка», «История», in the order of the design.
export const STYLE_CHIPS: readonly StyleChip[] = [
  { style: null, label: strings.topics.chips.all },
  { style: 'facts', label: styleCopy.facts.label },
  { style: 'fairy_tale', label: styleCopy.fairy_tale.label },
  { style: 'history', label: styleCopy.history.label },
];

export function withStyle(filter: TopicFilter, style: StoryStyle | null): TopicFilter {
  return { ...filter, style };
}

export function withReady(filter: TopicFilter, ready: ReadyFilter): TopicFilter {
  return { ...filter, ready };
}

export function withHeard(filter: TopicFilter, heard: HeardFilter): TopicFilter {
  return { ...filter, heard };
}

// What the two sheets offer, in the order of the design (frame s-topics-filter): the choice and
// its label. «Все» is first and resets the filter.
export const READY_OPTIONS: ReadonlyArray<{
  readonly value: ReadyFilter;
  readonly label: string;
}> = [
  { value: 'all', label: strings.topics.filters.ready.options.all },
  { value: 'ready', label: strings.topics.filters.ready.options.ready },
  { value: 'not', label: strings.topics.filters.ready.options.not },
];

export const HEARD_OPTIONS: ReadonlyArray<{
  readonly value: HeardFilter;
  readonly label: string;
}> = [
  { value: 'all', label: strings.topics.filters.heard.options.all },
  { value: 'new', label: strings.topics.filters.heard.options.new },
  { value: 'heard', label: strings.topics.filters.heard.options.heard },
];

// The label of a filter chip: its name while the filter is off, the short choice while it is on.
export function readyChipLabel(ready: ReadyFilter): string {
  return ready === 'all'
    ? strings.topics.filters.ready.chip
    : strings.topics.filters.ready.short[ready];
}

export function heardChipLabel(heard: HeardFilter): string {
  return heard === 'all'
    ? strings.topics.filters.heard.chip
    : strings.topics.filters.heard.short[heard];
}

// The query of the request: `ready` and `heard` are the text 'true' or 'false' (the server
// reads text); «Все» sends nothing, so the default filter sends no query at all.
export function topicsQuery(filter: TopicFilter): TopicsQuery {
  return {
    ...(filter.style !== null ? { style: filter.style } : {}),
    ...(filter.ready !== 'all'
      ? {
          ready: filter.ready === 'ready' ? ('true' as const) : ('false' as const),
        }
      : {}),
    ...(filter.heard !== 'all'
      ? {
          heard: filter.heard === 'heard' ? ('true' as const) : ('false' as const),
        }
      : {}),
  };
}

// '/topics' or '/topics?style=facts&ready=true&heard=false'. The values are enum members, so nothing needs
// escaping; URLSearchParams is avoided on purpose (incomplete in React Native).
export function topicsPath(filter: TopicFilter): string {
  const query = topicsQuery(filter);
  const parts: string[] = [];
  if (query.style !== undefined) parts.push(`style=${query.style}`);
  if (query.ready !== undefined) parts.push(`ready=${query.ready}`);
  if (query.heard !== undefined) parts.push(`heard=${query.heard}`);
  return parts.length > 0 ? `/topics?${parts.join('&')}` : '/topics';
}

// The route parameter that opens «Темы» with «Только готовые» already chosen («готовые истории» link on
// «Сегодня»). Expo Router gives a string, an array or nothing.
export const READY_PARAM = 'ready';

export function filterFromParams(value: string | string[] | undefined): TopicFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return first === '1' ? { ...DEFAULT_FILTER, ready: 'ready' } : DEFAULT_FILTER;
}

// True when the route asks for «Только готовые» (`ready=1`). «Темы» is a tab that stays mounted,
// so the parameter arrives after the first render; the screen reads it, sets the filter and
// clears the parameter.
export function readyParamRequested(value: string | string[] | undefined): boolean {
  return filterFromParams(value).ready === 'ready';
}
