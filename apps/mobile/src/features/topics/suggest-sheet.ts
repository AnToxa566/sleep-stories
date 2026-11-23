import type {
  Interest,
  Preferences,
  StoryStyle,
  SuggestTopicsRequest,
  SuggestionStatusResponse,
} from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../strings';
import { STYLE_ORDER } from './topic-filter';

// The sheet «Подобрать новые темы» on «Темы» (design frames 2e·2 to 2e·7) and the state of its
// three entry points. Pure; no React Native. The sheet offers only the person's own settings
// (their interests and styles). Every interest is ticked; of the styles only the one of the
// style filter, or every style under «Все», whichever entry opened the sheet (owner,
// 2026-11-23).

export type SheetChip = {
  // Unique within the sheet: `i:` + slug, `c:` + typed text, `s:` + style.
  readonly key: string;
  readonly label: string;
};

export type SheetOptions = {
  readonly interests: readonly SheetChip[];
  readonly styles: readonly SheetChip[];
};

// What is ticked. Keys of SheetChip, so one set covers catalogue and typed interests.
export type SheetSelection = {
  readonly interests: ReadonlySet<string>;
  readonly styles: ReadonlySet<string>;
};

const interestKey = (slug: string) => `i:${slug}`;
const customKey = (text: string) => `c:${text}`;
const styleKey = (style: StoryStyle) => `s:${style}`;

// The person's interests (catalogue ones in the catalogue's order, then the typed ones) and
// styles. Labels are lowercase as in the design; typed interests are already lowercase after
// the contract's normalisation. A chosen slug missing from the catalogue (deactivated) is left
// out: the server would refuse it.
export function sheetOptions(
  preferences: Pick<Preferences, 'styles' | 'interestSlugs' | 'customInterests'>,
  catalogue: readonly Interest[],
): SheetOptions {
  const chosen = new Set(preferences.interestSlugs);
  const interests: SheetChip[] = [
    ...catalogue
      .filter((interest) => chosen.has(interest.slug))
      .map((interest) => ({
        key: interestKey(interest.slug),
        label: interest.title.toLocaleLowerCase('ru'),
      })),
    ...preferences.customInterests.map((text) => ({ key: customKey(text), label: text })),
  ];
  const styles = STYLE_ORDER.filter((style) => preferences.styles.includes(style)).map(
    (style) => ({ key: styleKey(style), label: styleCopy[style].label }),
  );
  return { interests, styles };
}

// Every interest; the filter's style only (when the person has it), or every style under «Все».
export function initialSelection(options: SheetOptions, filterStyle: StoryStyle | null): SheetSelection {
  const all = options.styles.map((chip) => chip.key);
  const fromFilter = filterStyle === null ? null : styleKey(filterStyle);
  const styles = fromFilter !== null && all.includes(fromFilter) ? [fromFilter] : all;
  return {
    interests: new Set(options.interests.map((chip) => chip.key)),
    styles: new Set(styles),
  };
}

export function toggle(selected: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function hasChoice(selection: SheetSelection): boolean {
  return selection.interests.size > 0 && selection.styles.size > 0;
}

// The request body. The server checks every value against the person's settings again.
export function toRequest(selection: SheetSelection): SuggestTopicsRequest {
  const interestSlugs: string[] = [];
  const customInterests: string[] = [];
  for (const key of selection.interests) {
    if (key.startsWith('i:')) interestSlugs.push(key.slice(2));
    else if (key.startsWith('c:')) customInterests.push(key.slice(2));
  }
  const styles = STYLE_ORDER.filter((style) => selection.styles.has(styleKey(style)));
  return { styles, interestSlugs, customInterests };
}

// The line under «Подобрать темы»: the cap used up wins over everything (design 2e·7), then the
// request to tick something (2e·3), then what is left.
export function sheetCaption(
  selection: SheetSelection,
  suggestions: SuggestionStatusResponse['suggestions'],
  formatTime: (date: Date) => string,
): string {
  const copy = strings.topics.suggest;
  if (suggestions.left === 0) {
    return suggestions.nextAt === null
      ? copy.limitReached
      : copy.limitReachedUntil(formatTime(new Date(suggestions.nextAt)));
  }
  if (!hasChoice(selection)) return copy.chooseSomething;
  return copy.left(suggestions.left, suggestions.limit);
}

// «02:14»: hours and minutes on the phone's clock.
export function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// While a suggestion of the person runs (theirs from this sheet, or one the queue top-up
// started) a new one cannot start, so the three entry points are inactive.
export function isSuggesting(status: SuggestionStatusResponse | undefined): boolean {
  return status?.latest?.state === 'running';
}

// What became of the suggestion this phone started: null while it runs or when the answer is
// about another job. Only the started one ends in a snackbar, so an old result seen after a
// restart shows nothing.
export function finishedSuggestion(
  startedId: string | null,
  status: SuggestionStatusResponse | undefined,
): 'succeeded' | 'failed' | null {
  const latest = status?.latest;
  if (startedId === null || latest == null || latest.id !== startedId) return null;
  return latest.state === 'running' ? null : latest.state;
}
