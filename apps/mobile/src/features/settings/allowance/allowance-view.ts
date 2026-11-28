import type { QueueResponse } from '@sleep-stories/contracts';
import { strings } from '../../../strings';

type Generations = QueueResponse['generations'];

export type AllowanceLine = { lead: string; time: string };

export type AllowanceSheetView = { title: string; lines: AllowanceLine[] };

const MINUTE_MS = 60_000;

// What the sheet of «Генерации» says (design frame 4b·1). `left` is shown as the server sent
// it, also while stories are being created, and a line is there only when its time is known.
export function allowanceSheetView(
  generations: Generations,
  now: Date,
  formatTime: (date: Date) => string,
): AllowanceSheetView {
  const copy = strings.settings.allowanceSheet;
  const { left, limit } = generations;
  const title = copy.title(left, limit);
  if (left >= limit) return { title, lines: [] };

  const next = upcomingTime(generations.nextAt, now, formatTime);
  const full = upcomingTime(generations.fullAt, now, formatTime);
  const lines: AllowanceLine[] = [];
  // Two equal times (one generation spent, say) would say one thing twice: only the full
  // recovery stays.
  if (next !== null && next !== full) lines.push({ lead: copy.nextLead, time: next });
  if (full !== null) lines.push({ lead: copy.fullLead(limit), time: full });
  return { title, lines };
}

// The time as it is shown, or null when there is nothing to show.
//
// Rounded UP to a whole minute, so the sheet never promises a slot before it is there.
//
// A time that is not after `now` is dropped. The queue in the cache can be old (no network),
// and the sheet shows no day, so a passed time would read as tomorrow. «Passed» is judged on
// the rounded time, the one the person would read: 14:39:30 stays «14:40» until 14:40.
function upcomingTime(
  iso: string | null,
  now: Date,
  formatTime: (date: Date) => string,
): string | null {
  if (iso === null) return null;
  const rounded = Math.ceil(Date.parse(iso) / MINUTE_MS) * MINUTE_MS;
  return rounded > now.getTime() ? formatTime(new Date(rounded)) : null;
}
