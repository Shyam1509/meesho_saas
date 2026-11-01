/** India Standard Time (UTC+05:30, no daylight saving). */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date in India (YYYY-MM-DD). */
export function todayInIndia(now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The calendar date `days` after `date` (both YYYY-MM-DD; `days` may be negative). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
