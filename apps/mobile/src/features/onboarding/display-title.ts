// Custom topics are stored lowercase (the duplicate checks compare that form), while catalogue
// titles are capitalised. Only the displayed label is capitalised, so the two kinds of chip
// look the same; the stored and sent value is unchanged.
export function displayCustomTitle(text: string): string {
  const [first = '', ...rest] = Array.from(text);
  return first.toLocaleUpperCase('ru-RU') + rest.join('');
}
