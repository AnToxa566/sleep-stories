// True when `sent` holds exactly the ids in `current`: the same set, no id missing, no
// extra one and none repeated. A reorder is accepted only then, so a stale or hostile list
// can neither drop an item nor reach another person's item.
export function isSameSet(current: readonly string[], sent: readonly string[]): boolean {
  const sentSet = new Set(sent);
  if (sentSet.size !== sent.length || sent.length !== current.length) {
    return false;
  }
  return current.every((id) => sentSet.has(id));
}
