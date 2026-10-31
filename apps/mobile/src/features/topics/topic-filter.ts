import type { StoryStyle, TopicsQuery } from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../strings';

// The filter of «Темы» and «Замена»: one style or all, and «Готовые». Pure; no React Native.
// The server does the filtering (GET /topics?style=&ready=), so the filter is also the key of
// the cached list.

export type TopicFilter = {
  // null is «Все».
  readonly style: StoryStyle | null;
  readonly readyOnly: boolean;
};

export const DEFAULT_FILTER: TopicFilter = { style: null, readyOnly: false };

export type StyleChip = { readonly style: StoryStyle | null; readonly label: string };

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

export function toggleReady(filter: TopicFilter): TopicFilter {
  return { ...filter, readyOnly: !filter.readyOnly };
}

// The query of the request. `ready` is sent only when it narrows the list (the server reads
// the text 'true'); an unset filter sends nothing.
export function topicsQuery(filter: TopicFilter): TopicsQuery {
  return {
    ...(filter.style !== null ? { style: filter.style } : {}),
    ...(filter.readyOnly ? { ready: 'true' as const } : {}),
  };
}

// '/topics' or '/topics?style=facts&ready=true'. The values are enum members, so nothing needs
// escaping; URLSearchParams is avoided on purpose (incomplete in React Native).
export function topicsPath(filter: TopicFilter): string {
  const query = topicsQuery(filter);
  const parts: string[] = [];
  if (query.style !== undefined) parts.push(`style=${query.style}`);
  if (query.ready !== undefined) parts.push(`ready=${query.ready}`);
  return parts.length > 0 ? `/topics?${parts.join('&')}` : '/topics';
}

// The route parameter that opens «Темы» with «Готовые» already on («готовые истории» link on
// «Сегодня»). Expo Router gives a string, an array or nothing.
export const READY_PARAM = 'ready';

export function filterFromParams(value: string | string[] | undefined): TopicFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return first === '1' ? { ...DEFAULT_FILTER, readyOnly: true } : DEFAULT_FILTER;
}

// True when the route asks for «Готовые» (`ready=1`). «Темы» is a tab that stays mounted, so
// the parameter arrives after the first render; the screen reads it, turns the filter on and
// clears the parameter.
export function readyParamRequested(value: string | string[] | undefined): boolean {
  return filterFromParams(value).readyOnly;
}
