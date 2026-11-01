import { dateStringInTimeZone } from '../format/format';

/**
 * Relative date ranges ("last 30 days", "last month") as `YYYY-MM-DD` pairs, both ends inclusive.
 * "Today" is the calendar day in India ({@link BUSINESS_TIME_ZONE}), the day the API uses for its
 * defaults, so a viewer elsewhere still sees the same ranges as the server.
 */

export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

export type RangePreset = 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth';

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

export const RANGE_PRESET_IDS: readonly RangePreset[] = RANGE_PRESETS.map((p) => p.id);

export interface DateRangeValue {
  from: string;
  to: string;
}

/** Today in India (IST) as `YYYY-MM-DD`. */
export function todayInIndia(now: Date): string {
  return dateStringInTimeZone(now, BUSINESS_TIME_ZONE);
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus `days` (negative goes back). */
export function addDays(date: string, days: number): string {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

/** Days from `from` to `to`, both counted: the same day is 1. */
export function daysInRange(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;
}

/**
 * The range of a preset on India's calendar: the last N days end today (today included); "this
 * month" runs from the 1st to today; "last month" is the whole previous calendar month.
 */
export function presetRange(preset: RangePreset, now: Date): DateRangeValue {
  const today = todayInIndia(now);
  switch (preset) {
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const firstOfThisMonth = `${today.slice(0, 7)}-01`;
      const lastOfPrevious = addDays(firstOfThisMonth, -1);
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious };
    }
  }
}
