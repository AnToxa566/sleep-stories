import { CustomInterestSchema, type Interest } from '@sleep-stories/contracts';

// The API refuses a custom topic equal to an active catalogue title (compared lowercased),
// and the app would only learn that at the last onboarding step. So a typed topic that
// matches a chip is turned into that chip's selection at entry. The text is normalised
// exactly like CustomInterestSchema (trim, NFC, lowercase); titles get the same treatment.
export type InterestEntry =
  | { kind: 'catalogue'; slug: string; alreadySelected: boolean }
  | { kind: 'custom' };

const normalise = (text: string): string => text.trim().normalize('NFC').toLowerCase();

export function resolveInterestEntry(
  text: string,
  catalogue: readonly Pick<Interest, 'slug' | 'title'>[],
  selectedSlugs: readonly string[],
): InterestEntry {
  // Blank or invalid text is left to the store, which rejects it.
  const parsed = CustomInterestSchema.safeParse(text);
  if (!parsed.success) return { kind: 'custom' };
  const match = catalogue.find((interest) => normalise(interest.title) === parsed.data);
  if (!match) return { kind: 'custom' };
  return { kind: 'catalogue', slug: match.slug, alreadySelected: selectedSlugs.includes(match.slug) };
}
