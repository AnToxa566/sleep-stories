// Pure helpers for numbers in Russian copy. The nouns themselves live in strings.ts.

export type PluralForms = readonly [one: string, few: string, many: string];

// Russian plural rule: 1, 21, 31 take the first form; 2 to 4 (except 12 to 14) the second;
// everything else the third. Non-integers and negatives use the absolute whole part.
export function pluralRu(count: number, forms: PluralForms): string {
  const n = Math.abs(Math.trunc(count));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

// 151 -> "2:31". Whole seconds, rounded down; a bad or negative value shows "0:00".
export function formatDuration(totalSec: number): string {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const minutes = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

// 0 -> "01": the row number shown before a title.
export function formatPosition(index: number): string {
  return String(index + 1).padStart(2, '0');
}
