import { formatClock } from '../../../format/clock/clock';
import { allowanceSheetView } from './allowance-view';

// Times are built on the local clock, so the expected «14:40» holds in any time zone.
const at = (hours: number, minutes: number, seconds = 0, ms = 0, day = 28) =>
  new Date(2026, 10, day, hours, minutes, seconds, ms);
const iso = (...args: Parameters<typeof at>) => at(...args).toISOString();

const now = at(12, 0);
const view = (
  left: number,
  nextAt: string | null,
  fullAt: string | null,
  { limit = 5, moment = now } = {},
) => allowanceSheetView({ left, limit, nextAt, fullAt }, moment, formatClock);

const next = (time: string) => ({ lead: 'Следующая генерация восстановится в', time });
const full = (time: string) => ({ lead: 'Полное восстановление (5/5) — в', time });

describe('allowanceSheetView', () => {
  it('is only the title when everything is available', () => {
    expect(view(5, null, null)).toEqual({ title: 'Доступно 5 из 5 генераций', lines: [] });
    // The title decides: times that came along anyway are not shown.
    expect(view(5, iso(14, 40), iso(18, 40)).lines).toEqual([]);
  });

  it('shows the next and the full recovery, next first', () => {
    expect(view(3, iso(14, 40), iso(18, 40))).toEqual({
      title: 'Доступно 3 из 5 генераций',
      lines: [next('14:40'), full('18:40')],
    });
  });

  it('shows only the full recovery when both read the same', () => {
    expect(view(4, iso(14, 40), iso(14, 40)).lines).toEqual([full('14:40')]);
    // Different instants that round to one minute.
    expect(view(3, iso(14, 39, 5), iso(14, 39, 50)).lines).toEqual([full('14:40')]);
  });

  it('keeps both lines when nothing is left', () => {
    expect(view(0, iso(14, 40), iso(18, 40))).toEqual({
      title: 'Доступно 0 из 5 генераций',
      lines: [next('14:40'), full('18:40')],
    });
  });

  it('shows only the next one while something is in progress', () => {
    expect(view(2, iso(14, 40), null).lines).toEqual([next('14:40')]);
  });

  it('is only the title when no time is known', () => {
    expect(view(4, null, null)).toEqual({ title: 'Доступно 4 из 5 генераций', lines: [] });
  });

  it('drops a passed time and keeps a future one', () => {
    expect(view(3, iso(11, 0), iso(18, 40)).lines).toEqual([full('18:40')]);
  });

  it('drops every time once all have passed', () => {
    expect(view(3, iso(9, 0), iso(11, 59)).lines).toEqual([]);
    // Exactly now is not ahead any more.
    expect(view(3, iso(12, 0), iso(12, 0)).lines).toEqual([]);
  });

  it('judges «passed» on the rounded time', () => {
    const moment = at(14, 39, 45);
    expect(view(4, null, iso(14, 39, 30), { moment }).lines).toEqual([full('14:40')]);
    expect(view(4, null, iso(14, 39, 30), { moment: at(14, 40) }).lines).toEqual([]);
  });

  it('rounds up to a whole minute and keeps a whole one', () => {
    expect(view(3, iso(14, 40, 0, 1), iso(18, 40)).lines).toEqual([next('14:41'), full('18:40')]);
    expect(view(3, iso(14, 40, 59, 999), iso(18, 40)).lines[0]).toEqual(next('14:41'));
  });

  it('rounds across midnight, with the time only', () => {
    const moment = at(23, 0);
    expect(view(3, iso(23, 59, 30), iso(1, 5, 0, 0, 29), { moment }).lines).toEqual([
      next('00:00'),
      full('01:05'),
    ]);
  });

  it('takes the limit from the server', () => {
    expect(view(7, null, iso(14, 40), { limit: 8 })).toEqual({
      title: 'Доступно 7 из 8 генераций',
      lines: [{ lead: 'Полное восстановление (8/8) — в', time: '14:40' }],
    });
    expect(view(8, null, null, { limit: 8 }).lines).toEqual([]);
  });
});
