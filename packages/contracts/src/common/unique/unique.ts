// For the arrays that must not repeat an entry. Used inside this package only, so
// src/index.ts does not export it.
export const hasUniqueEntries = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;
