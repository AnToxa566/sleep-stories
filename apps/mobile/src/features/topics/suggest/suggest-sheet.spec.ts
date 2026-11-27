import type { Interest, SuggestionStatusResponse } from '@sleep-stories/contracts';
import {
  finishedSuggestion,
  formatClock,
  hasChoice,
  initialSelection,
  isSuggesting,
  sheetCaption,
  sheetOptions,
  toRequest,
  toggle,
} from './suggest-sheet';

const catalogue: Interest[] = [
  { slug: 'history', title: 'История' },
  { slug: 'space', title: 'Космос' },
  { slug: 'nature', title: 'Природа' },
];
const preferences = {
  styles: ['history', 'facts'] as ('facts' | 'history')[],
  interestSlugs: ['space', 'history', 'gone'],
  customInterests: ['морские звёзды'],
};
const options = sheetOptions(preferences, catalogue);
const id = '3f2b8c1e-5a4d-4e6f-8a7b-9c0d1e2f3a4b';
const status = (
  latest: SuggestionStatusResponse['latest'],
  left = 3,
  nextAt: string | null = null,
): SuggestionStatusResponse => ({ latest, suggestions: { left, limit: 5, nextAt } });

describe('sheetOptions', () => {
  it('offers only the person’s interests (catalogue order, then typed) and styles (app order)', () => {
    expect(options.interests).toEqual([
      { key: 'i:history', label: 'История' },
      { key: 'i:space', label: 'Космос' },
      { key: 'c:морские звёзды', label: 'Морские звёзды' },
    ]);
    expect(options.styles).toEqual([
      { key: 's:facts', label: 'Факты' },
      { key: 's:history', label: 'История' },
    ]);
  });
});

describe('initialSelection', () => {
  it('ticks everything under «Все»', () => {
    const selection = initialSelection(options, null);
    expect([...selection.interests]).toEqual(['i:history', 'i:space', 'c:морские звёзды']);
    expect([...selection.styles]).toEqual(['s:facts', 's:history']);
  });

  it('ticks only the filter’s style while a style chip is on', () => {
    expect([...initialSelection(options, 'history').styles]).toEqual(['s:history']);
  });

  it('falls back to every style when the filter’s style is not the person’s', () => {
    expect([...initialSelection(options, 'fairy_tale').styles]).toEqual(['s:facts', 's:history']);
  });
});

describe('toggle, hasChoice and toRequest', () => {
  it('needs at least one interest and one style', () => {
    const all = initialSelection(options, null);
    expect(hasChoice(all)).toBe(true);
    expect(hasChoice({ ...all, styles: new Set() })).toBe(false);
    expect(hasChoice({ ...all, interests: new Set() })).toBe(false);
  });

  it('toggles a key off and on again without touching the original', () => {
    const before = new Set(['a', 'b']);
    const off = toggle(before, 'a');
    expect([...off]).toEqual(['b']);
    expect([...toggle(off, 'a')]).toEqual(['b', 'a']);
    expect([...before]).toEqual(['a', 'b']);
  });

  it('splits catalogue and typed interests and orders the styles', () => {
    const selection = {
      interests: new Set(['c:морские звёзды', 'i:space']),
      styles: new Set(['s:history', 's:facts']),
    };
    expect(toRequest(selection)).toEqual({
      styles: ['facts', 'history'],
      interestSlugs: ['space'],
      customInterests: ['морские звёзды'],
    });
  });
});

describe('sheetCaption', () => {
  const all = initialSelection(options, null);
  const none = { ...all, styles: new Set<string>() };
  const time = () => '02:14';

  it('shows what is left', () => {
    expect(sheetCaption(all, status(null).suggestions, time)).toBe('Осталось 3 из 5');
  });

  it('asks to tick something when nothing is ticked', () => {
    expect(sheetCaption(none, status(null).suggestions, time)).toBe(
      'Выберите хотя бы один интерес и стиль',
    );
  });

  it('shows the used-up cap first, with the time when one comes back', () => {
    const used = status(null, 0, '2026-11-23T02:14:00.000Z').suggestions;
    expect(sheetCaption(none, used, time)).toBe('Попытки закончились · следующая в 02:14');
    expect(sheetCaption(all, status(null, 0).suggestions, time)).toBe('Попытки закончились');
  });
});

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 10, 23, 2, 4))).toBe('02:04');
    expect(formatClock(new Date(2026, 10, 23, 23, 59))).toBe('23:59');
  });
});

describe('isSuggesting and finishedSuggestion', () => {
  it('is suggesting only while the newest suggestion runs, whoever started it', () => {
    expect(isSuggesting(undefined)).toBe(false);
    expect(isSuggesting(status(null))).toBe(false);
    expect(isSuggesting(status({ id, state: 'running' }))).toBe(true);
    expect(isSuggesting(status({ id, state: 'failed' }))).toBe(false);
  });

  it('reports the end of the suggestion this phone started, and nothing else', () => {
    expect(finishedSuggestion(id, status({ id, state: 'running' }))).toBeNull();
    expect(finishedSuggestion(id, status({ id, state: 'succeeded' }))).toBe('succeeded');
    expect(finishedSuggestion(id, status({ id, state: 'failed' }))).toBe('failed');
    expect(finishedSuggestion(null, status({ id, state: 'succeeded' }))).toBeNull();
    expect(
      finishedSuggestion('7a1c9d2e-6b3f-4a8c-9d1e-0f2a3b4c5d6e', status({ id, state: 'failed' })),
    ).toBeNull();
    expect(finishedSuggestion(id, undefined)).toBeNull();
  });
});
