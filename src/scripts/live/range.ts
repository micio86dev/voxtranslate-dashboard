/** Date ranges for the usage page and the sessions filter. */

export interface IsoRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS: { days: 7 | 30 | 90; default?: boolean }[] = [
  { days: 7 },
  { days: 30, default: true },
  { days: 90 },
];

/** The server refuses a longer window with 400 `bad_range`. */
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

/** The last `days` days, ending now. */
export function presetRange(days: number, now: Date = new Date()): IsoRange {
  return {
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  };
}

function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // `new Date(2026, 12, 45)` rolls over instead of failing, so check it came back unchanged.
  const same =
    d.getFullYear() === Number(m[1]) &&
    d.getMonth() === Number(m[2]) - 1 &&
    d.getDate() === Number(m[3]);
  return same ? d : null;
}

/** Local midnight at the start of `YYYY-MM-DD`, as an instant. */
export function dayStartIso(day: string): string {
  return (parseDay(day) ?? new Date(NaN)).toISOString();
}

/** Local midnight at the start of the day AFTER `YYYY-MM-DD`: the exclusive end of that day. */
export function nextDayStartIso(day: string): string {
  const d = parseDay(day);
  if (!d) return new Date(NaN).toISOString();
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export type CustomRange =
  | { ok: true; range: IsoRange }
  | { ok: false; error: 'required' | 'order' | 'tooLong' };

/** Two day inputs as an inclusive range, checked the way the server checks it. */
export function customRange(fromDay: string, toDay: string): CustomRange {
  const from = parseDay(fromDay);
  const to = parseDay(toDay);
  if (!from || !to) return { ok: false, error: 'required' };
  if (to.getTime() < from.getTime()) return { ok: false, error: 'order' };
  const range = { from: dayStartIso(fromDay), to: nextDayStartIso(toDay) };
  if (Date.parse(range.to) - Date.parse(range.from) > MAX_DAYS * DAY_MS) {
    return { ok: false, error: 'tooLong' };
  }
  return { ok: true, range };
}
