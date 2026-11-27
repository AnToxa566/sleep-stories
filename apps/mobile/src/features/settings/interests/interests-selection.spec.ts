import { CUSTOM_INTERESTS_MAX_COUNT, INTEREST_SLUGS_MAX_COUNT } from '@sleep-stories/contracts';
import {
  addInterest,
  draftFromSaved,
  interestsToSave,
  toggleCustom,
  toggleSlug,
} from './interests-selection';

const catalogue = [
  { slug: 'space', title: 'Космос' },
  { slug: 'sea', title: 'Море' },
  { slug: 'history', title: 'История' },
];
// `gone` is saved but no longer in the catalogue.
const saved = { interestSlugs: ['space', 'gone'], customInterests: ['маяки', 'поезда'] };
const start = draftFromSaved(saved);
const toSave = (draft: typeof start) => interestsToSave({ saved, draft, catalogue });

const many = (count: number) => Array.from({ length: count }, (_, index) => `тема ${index}`);

describe('interests draft', () => {
  it('starts as the saved lists, with every typed topic shown and on', () => {
    expect(start).toEqual({
      slugs: ['space', 'gone'],
      shownCustom: ['маяки', 'поезда'],
      selectedCustom: ['маяки', 'поезда'],
    });
  });

  it('switches a catalogue interest on and off', () => {
    const on = toggleSlug(start, 'sea', catalogue);
    expect(on.slugs).toContain('sea');
    expect(toggleSlug(on, 'sea', catalogue).slugs).not.toContain('sea');
  });

  it('keeps the chip of a deselected typed topic and can select it again', () => {
    const off = toggleCustom(start, 'маяки');
    expect(off.shownCustom).toEqual(['маяки', 'поезда']);
    expect(off.selectedCustom).toEqual(['поезда']);
    expect(toggleCustom(off, 'маяки').selectedCustom).toContain('маяки');
  });

  it('ignores a tap on a typed topic that has no chip', () => {
    expect(toggleCustom(start, 'вулканы')).toBe(start);
  });

  it('adds a new typed topic, normalised', () => {
    const { draft, taken } = addInterest(start, '  Вулканы ', catalogue);
    expect(taken).toBe(true);
    expect(draft.shownCustom).toEqual(['маяки', 'поезда', 'вулканы']);
    expect(draft.selectedCustom).toEqual(['маяки', 'поезда', 'вулканы']);
  });

  it('selects the chip of a typed text that is a catalogue title', () => {
    const { draft, taken } = addInterest(start, ' МОРЕ ', catalogue);
    expect(taken).toBe(true);
    expect(draft.slugs).toContain('sea');
    expect(draft.shownCustom).toEqual(start.shownCustom);
  });

  it('does not switch off a catalogue chip that is already on, and takes the text', () => {
    const result = addInterest(start, 'космос', catalogue);
    expect(result).toEqual({ draft: start, taken: true });
    expect(result.draft).toBe(start);
  });

  it('selects a deselected typed topic again without a second chip', () => {
    const off = toggleCustom(start, 'маяки');
    const { draft, taken } = addInterest(off, 'Маяки', catalogue);
    expect(taken).toBe(true);
    expect(draft.shownCustom).toEqual(['маяки', 'поезда']);
    expect(draft.selectedCustom).toContain('маяки');
  });

  it('leaves in the field a typed topic that is already on', () => {
    expect(addInterest(start, 'маяки', catalogue)).toEqual({ draft: start, taken: false });
  });

  it('refuses blank, too long and control-character text', () => {
    for (const text of ['   ', 'а'.repeat(61), 'раз\nдва']) {
      expect(addInterest(start, text, catalogue)).toEqual({ draft: start, taken: false });
    }
  });

  it('adds typed text while the catalogue is not loaded', () => {
    expect(addInterest(start, 'море', undefined).draft.selectedCustom).toContain('море');
  });

  it('neither adds nor reselects a typed topic once the limit is on', () => {
    const topics = many(CUSTOM_INTERESTS_MAX_COUNT);
    const full = draftFromSaved({ interestSlugs: [], customInterests: topics });
    expect(addInterest(full, 'ещё одна', catalogue)).toEqual({ draft: full, taken: false });

    // One off, another added in its place: the first one cannot come back.
    const replaced = addInterest(toggleCustom(full, 'тема 0'), 'новая', catalogue).draft;
    expect(replaced.selectedCustom).toHaveLength(CUSTOM_INTERESTS_MAX_COUNT);
    expect(toggleCustom(replaced, 'тема 0')).toBe(replaced);
    expect(addInterest(replaced, 'тема 0', catalogue).taken).toBe(false);
    // The catalogue has its own limit, so a catalogue chip is still free.
    expect(addInterest(replaced, 'море', catalogue).draft.slugs).toContain('sea');
  });

  it('does not pick more catalogue interests than the contract allows', () => {
    const big = Array.from({ length: INTEREST_SLUGS_MAX_COUNT + 1 }, (_, index) => ({
      slug: `s${index}`,
      title: `Интерес ${index}`,
    }));
    const slugs = big.slice(0, INTEREST_SLUGS_MAX_COUNT).map((interest) => interest.slug);
    const full = draftFromSaved({ interestSlugs: slugs, customInterests: [] });
    const extra = `s${INTEREST_SLUGS_MAX_COUNT}`;
    expect(toggleSlug(full, extra, big)).toBe(full);
    expect(addInterest(full, `интерес ${INTEREST_SLUGS_MAX_COUNT}`, big).taken).toBe(false);

    // A slug that left the catalogue takes no place.
    const withGone = draftFromSaved({
      interestSlugs: [...slugs.slice(1), 'gone'],
      customInterests: [],
    });
    expect(toggleSlug(withGone, extra, big).slugs).toContain(extra);
  });
});

describe('interestsToSave', () => {
  it('has nothing to save before the first edit, the gone slug included', () => {
    expect(interestsToSave({ saved, draft: null, catalogue })).toBeNull();
    expect(toSave(start)).toBeNull();
  });

  it('does not count a gone slug as a change', () => {
    const withoutGone = { ...start, slugs: ['space'] };
    expect(toSave(withoutGone)).toBeNull();
  });

  it('sends only catalogue slugs and the selected typed topics', () => {
    const draft = toggleCustom(toggleSlug(start, 'sea', catalogue), 'поезда');
    expect(toSave(draft)).toEqual({
      interestSlugs: ['space', 'sea'],
      customInterests: ['маяки'],
    });
  });

  it('can save a change of either list alone', () => {
    expect(toSave(toggleSlug(start, 'sea', catalogue))).not.toBeNull();
    expect(toSave(toggleCustom(start, 'маяки'))).not.toBeNull();
  });

  it('ignores the order, so reverting an edit disables the button', () => {
    const slugs = toggleSlug(toggleSlug(start, 'space', catalogue), 'space', catalogue);
    expect(slugs.slugs).not.toEqual(start.slugs);
    expect(toSave(slugs)).toBeNull();
    const custom = toggleCustom(toggleCustom(start, 'маяки'), 'маяки');
    expect(custom.selectedCustom).not.toEqual(start.selectedCustom);
    expect(toSave(custom)).toBeNull();
    // A topic added here and switched off again is a chip, not a change.
    const added = toggleCustom(addInterest(start, 'вулканы', catalogue).draft, 'вулканы');
    expect(toSave(added)).toBeNull();
  });

  it('cannot save with nothing selected, even if a gone slug is left in the draft', () => {
    const empty = toggleCustom(
      toggleCustom(toggleSlug(start, 'space', catalogue), 'маяки'),
      'поезда',
    );
    expect(empty.slugs).toEqual(['gone']);
    expect(toSave(empty)).toBeNull();
  });

  it('cannot save before /me or the catalogue is loaded', () => {
    const draft = toggleSlug(start, 'sea', catalogue);
    expect(interestsToSave({ saved: null, draft, catalogue })).toBeNull();
    expect(interestsToSave({ saved, draft, catalogue: undefined })).toBeNull();
  });

  it('does not send a picked interest that has left the catalogue under the draft', () => {
    const draft = toggleCustom(toggleSlug(start, 'sea', catalogue), 'поезда');
    const shorter = catalogue.filter((interest) => interest.slug !== 'sea');
    expect(interestsToSave({ saved, draft, catalogue: shorter })).toEqual({
      interestSlugs: ['space'],
      customInterests: ['маяки'],
    });
    // If that pick was the only change, nothing is left to save.
    expect(
      interestsToSave({ saved, draft: toggleSlug(start, 'sea', catalogue), catalogue: shorter }),
    ).toBeNull();
  });

  it('compares with the new saved lists when /me changes under the draft', () => {
    const draft = toggleSlug(start, 'sea', catalogue);
    // A save that timed out had reached the server after all.
    const caughtUp = { interestSlugs: ['sea', 'space'], customInterests: ['поезда', 'маяки'] };
    expect(interestsToSave({ saved: caughtUp, draft, catalogue })).toBeNull();
    // The server holds a topic the screen never showed: only what has a chip is sent.
    const other = { interestSlugs: ['space', 'history'], customInterests: ['вулканы'] };
    expect(interestsToSave({ saved: other, draft, catalogue })).toEqual({
      interestSlugs: ['space', 'sea'],
      customInterests: ['маяки', 'поезда'],
    });
  });
});
