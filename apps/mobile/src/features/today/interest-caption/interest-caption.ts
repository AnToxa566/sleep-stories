import type { Interest, Preferences } from '@sleep-stories/contracts';

// How many interests the caption under the empty-state buttons names.
export const CAPTION_INTEREST_COUNT = 3;

// The person's own interests for the caption «Три истории на темы: …» (design frame 2a·12):
// the selected catalogue interests first, in the order the API returns them (the order of
// onboarding), then the typed ones, at most three. Catalogue titles are lowercased as in the
// design; typed interests are already lowercase after the contract's normalisation. A slug that
// is not in the catalogue is skipped. The text is shown only on the person's own screen
// (security rule 10). Returns an empty list when there is nothing to name.
export function captionInterests(
  preferences: Pick<Preferences, 'interestSlugs' | 'customInterests'>,
  catalogue: readonly Interest[],
): string[] {
  const titles = new Map(catalogue.map((interest) => [interest.slug, interest.title]));
  const selected: string[] = [];
  for (const slug of preferences.interestSlugs) {
    const title = titles.get(slug);
    if (title !== undefined) selected.push(title.toLocaleLowerCase('ru'));
  }
  return [...selected, ...preferences.customInterests].slice(0, CAPTION_INTEREST_COUNT);
}
