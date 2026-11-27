// What the narrator screen shows as selected, and whether there is anything to save. Pure.

type Input = {
  // The narrator the server holds; null while /me has no preferences.
  saved: string | null;
  // The row tapped on this visit; null until a tap.
  picked: string | null;
  // Undefined until the voices are loaded.
  voices: readonly { readonly slug: string }[] | undefined;
};

type NarratorSelection = {
  // A saved voice that is no longer in the list matches no row, so none looks selected.
  selected: string | null;
  // The voice the save button would send, or null while the button is inactive: nothing was
  // picked, the pick is the saved voice, or the picked voice is not in the list.
  toSave: string | null;
};

export function narratorSelection({ saved, picked, voices }: Input): NarratorSelection {
  const changed =
    saved !== null &&
    picked !== null &&
    picked !== saved &&
    (voices?.some((voice) => voice.slug === picked) ?? false);
  return { selected: picked ?? saved, toSave: changed ? picked : null };
}
