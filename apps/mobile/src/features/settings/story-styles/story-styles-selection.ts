import {
  ChangeStylesRequestSchema,
  StoryStyleSchema,
  type ChangeStylesRequest,
  type StoryStyle,
} from '@sleep-stories/contracts';

// The draft of the screen «Стили»: which rows are ticked, and what the save button would
// send. Pure. The draft is null until the first tap: until then the screen follows what the
// server holds.

// The list may become empty on the way to another choice; it cannot be saved like that.
export function toggleStyle(
  selected: readonly StoryStyle[],
  style: StoryStyle,
): readonly StoryStyle[] {
  return selected.includes(style)
    ? selected.filter((other) => other !== style)
    : [...selected, style];
}

// Both lists without repeats: the contract has checked the draft, and the server the saved one.
function sameSet(a: readonly StoryStyle[], b: readonly StoryStyle[]): boolean {
  return a.length === b.length && a.every((style) => b.includes(style));
}

type SaveInput = {
  // null while /me has no preferences.
  readonly saved: readonly StoryStyle[] | null;
  readonly draft: readonly StoryStyle[] | null;
};

// What «Сохранить изменения» would send, in the order of the rows, or null while the button is
// inactive: nothing is loaded or tapped yet, the set is the saved one, or the contract refuses
// the draft (no style ticked).
export function stylesToSave({ saved, draft }: SaveInput): ChangeStylesRequest | null {
  if (saved === null || draft === null) return null;
  const parsed = ChangeStylesRequestSchema.safeParse({ styles: draft });
  if (!parsed.success || sameSet(parsed.data.styles, saved)) return null;
  const chosen = parsed.data.styles;
  return { styles: StoryStyleSchema.options.filter((style) => chosen.includes(style)) };
}
