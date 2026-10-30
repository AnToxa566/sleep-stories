// Values that go into the tagged blocks of a user message are data, and some of them are
// typed by a person or written by a model. Two things could make a value act as part of
// the prompt: an angle bracket (it could close a tag and start text outside the block)
// and a line break (it could fake another list entry). Both are removed here, so one
// value stays one line inside its tag. Costs a lost "<" in a legitimate title, which does
// not occur in Russian story topics.
export function cleanValue(value: string): string {
  return value
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// One value per line. An empty list is written as "(нет)" so the model sees an explicit
// "none" instead of an empty tag.
export function renderList(values: readonly string[]): string {
  const lines = values.map(cleanValue).filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join('\n') : '(нет)';
}
