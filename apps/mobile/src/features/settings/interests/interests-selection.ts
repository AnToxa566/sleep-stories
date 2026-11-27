import {
  ChangeInterestsRequestSchema,
  CUSTOM_INTERESTS_MAX_COUNT,
  CustomInterestSchema,
  INTEREST_SLUGS_MAX_COUNT,
  type ChangeInterestsRequest,
  type Interest,
  type Preferences,
} from '@sleep-stories/contracts';
import { resolveInterestEntry } from '../../../ui/interests/catalogue-match';

// The draft of the screen «Интересы»: what its chips show, and what the save button would
// send. Pure.
//
// An edit that changes nothing returns the draft it was given, so the screen can tell it from
// a real edit and keeps showing the saved lists until the first one.

export type InterestsDraft = {
  // Picked catalogue slugs. May hold a saved one that has left the catalogue: it has no chip,
  // and `interestsToSave` neither counts nor sends it.
  readonly slugs: readonly string[];
  // Every typed topic with a chip: the saved ones, then the ones added here. A deselected one
  // stays until the person leaves.
  readonly shownCustom: readonly string[];
  // The typed topics that are on; always among `shownCustom`.
  readonly selectedCustom: readonly string[];
};

type SavedInterests = Pick<Preferences, 'interestSlugs' | 'customInterests'>;

// Undefined until the catalogue has been read.
type Catalogue = readonly Pick<Interest, 'slug' | 'title'>[] | undefined;

export function draftFromSaved(saved: SavedInterests): InterestsDraft {
  return {
    slugs: saved.interestSlugs,
    shownCustom: saved.customInterests,
    selectedCustom: saved.customInterests,
  };
}

// The slugs that count: those with a chip on the screen.
function activeOnly(slugs: readonly string[], catalogue: NonNullable<Catalogue>): string[] {
  const active = new Set(catalogue.map((interest) => interest.slug));
  return slugs.filter((slug) => active.has(slug));
}

// The contract's limit. A slug that left the catalogue is not sent, so it takes no place.
const slugsFull = (draft: InterestsDraft, catalogue: Catalogue): boolean =>
  activeOnly(draft.slugs, catalogue ?? []).length >= INTEREST_SLUGS_MAX_COUNT;

const customFull = (draft: InterestsDraft): boolean =>
  draft.selectedCustom.length >= CUSTOM_INTERESTS_MAX_COUNT;

// A tap on a catalogue chip. Over the limit, selecting does nothing.
export function toggleSlug(
  draft: InterestsDraft,
  slug: string,
  catalogue: Catalogue,
): InterestsDraft {
  if (draft.slugs.includes(slug)) {
    return { ...draft, slugs: draft.slugs.filter((entry) => entry !== slug) };
  }
  if (slugsFull(draft, catalogue)) return draft;
  return { ...draft, slugs: [...draft.slugs, slug] };
}

// A tap on a typed chip. The chip stays either way. With 20 typed topics on, selecting
// another does nothing.
export function toggleCustom(draft: InterestsDraft, text: string): InterestsDraft {
  if (draft.selectedCustom.includes(text)) {
    return { ...draft, selectedCustom: draft.selectedCustom.filter((entry) => entry !== text) };
  }
  if (!draft.shownCustom.includes(text) || customFull(draft)) return draft;
  return { ...draft, selectedCustom: [...draft.selectedCustom, text] };
}

// The «+» button and the keyboard's «Готово». `taken` tells the field to clear; a refused
// text stays in it. As in onboarding: a catalogue title selects that chip (never switches it
// off) and is taken even if the chip is already on, while a typed topic that is already on is
// not taken.
export function addInterest(
  draft: InterestsDraft,
  text: string,
  catalogue: Catalogue,
): { draft: InterestsDraft; taken: boolean } {
  const refused = { draft, taken: false };
  const entry = resolveInterestEntry(text, catalogue ?? [], draft.slugs);
  if (entry.kind === 'catalogue') {
    if (entry.alreadySelected) return { draft, taken: true };
    if (slugsFull(draft, catalogue)) return refused;
    return { draft: toggleSlug(draft, entry.slug, catalogue), taken: true };
  }

  const parsed = CustomInterestSchema.safeParse(text);
  if (!parsed.success) return refused;
  const topic = parsed.data;
  if (draft.selectedCustom.includes(topic) || customFull(draft)) return refused;
  return {
    draft: {
      ...draft,
      shownCustom: draft.shownCustom.includes(topic)
        ? draft.shownCustom
        : [...draft.shownCustom, topic],
      selectedCustom: [...draft.selectedCustom, topic],
    },
    taken: true,
  };
}

// Neither list repeats an entry (the contract, and the edits above).
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry) => b.includes(entry));

type SaveInput = {
  // What the server holds; null while /me has no preferences.
  saved: SavedInterests | null;
  // Null until the first edit.
  draft: InterestsDraft | null;
  // The catalogue whose chips are on the screen.
  catalogue: Catalogue;
};

// The request the save button would send, or null while the button is inactive: something is
// not loaded, nothing differs from what is saved, or the contract refuses the lists (nothing
// is selected). Slugs are compared and sent only among those in the catalogue, so a saved one
// that has left it does not count as a change and goes away with the next real save. The
// request therefore holds only what has a selected chip.
export function interestsToSave({
  saved,
  draft,
  catalogue,
}: SaveInput): ChangeInterestsRequest | null {
  if (saved === null || draft === null || catalogue === undefined) return null;
  const interestSlugs = activeOnly(draft.slugs, catalogue);
  const unchanged =
    sameSet(interestSlugs, activeOnly(saved.interestSlugs, catalogue)) &&
    sameSet(draft.selectedCustom, saved.customInterests);
  if (unchanged) return null;
  const parsed = ChangeInterestsRequestSchema.safeParse({
    interestSlugs,
    customInterests: draft.selectedCustom,
  });
  return parsed.success ? parsed.data : null;
}
