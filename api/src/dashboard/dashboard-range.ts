import type { DateBasis } from '../common/http/date-basis';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import { addDays, todayInIndia } from '../common/time/india-date';

/**
 * Dashboard filters (Milestone 7 design): `from`, `to` (inclusive YYYY-MM-DD, max range 731 days, default
 * last 30 days ending today IST), `basis` (`order_date` | `payment_date`, default `order_date`), optional
 * `status` (repeatable raw order statuses), `granularity` (day | week (ISO, Monday) | month; default day
 * ≤ 62 days, week ≤ 366, else month). Every length here counts days INCLUSIVELY (from = to is 1 day).
 */
export const DASHBOARD_MAX_RANGE_DAYS = 731;
export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;
export const DAY_GRANULARITY_MAX_DAYS = 62;
export const WEEK_GRANULARITY_MAX_DAYS = 366;

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface DashboardFilterInput {
  from?: string;
  to?: string;
  basis?: DateBasis;
  status?: string[];
  granularity?: Granularity;
}

/** The filters a dashboard was computed with, defaults applied (echoed back as `filters`). */
export interface ResolvedDashboardFilters {
  from: string;
  to: string;
  basis: DateBasis;
  /** De-duplicated, in the order given; [] = no status filter. */
  statuses: string[];
  granularity: Granularity;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Days from `from` to `to`, both included (YYYY-MM-DD; 1 when equal, < 1 when to is before from). */
export function daysInRange(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS) + 1;
}

/** Default granularity for a range of `days` days: day ≤ 62, week ≤ 366, else month. */
export function defaultGranularity(days: number): Granularity {
  if (days <= DAY_GRANULARITY_MAX_DAYS) return 'day';
  if (days <= WEEK_GRANULARITY_MAX_DAYS) return 'week';
  return 'month';
}

/**
 * Applies the defaults and checks the range. `to` defaults to today in India, `from` to `to` − 29 days
 * (30 days including both ends). Dates are already real YYYY-MM-DD (DTO validation) and `to` is not before
 * `from` when both were given; a `from` after the defaulted `to` (a future `from` without `to`) or a range
 * longer than 731 days → 400 with the field named.
 */
export function resolveDashboardFilters(
  input: DashboardFilterInput,
  today: string = todayInIndia(),
): ResolvedDashboardFilters {
  const to = input.to ?? today;
  const from = input.from ?? addDays(to, -(DASHBOARD_DEFAULT_RANGE_DAYS - 1));
  const days = daysInRange(from, to);
  if (days < 1) {
    throw new RequestValidationException([
      {
        field: input.to === undefined ? 'from' : 'to',
        reasons: [
          input.to === undefined
            ? 'from must not be after to (to defaults to today, India time)'
            : 'to must not be before from',
        ],
      },
    ]);
  }
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    throw new RequestValidationException([
      {
        field: 'to',
        reasons: [
          `the range from from to to must not be longer than ${DASHBOARD_MAX_RANGE_DAYS} days`,
        ],
      },
    ]);
  }
  return {
    from,
    to,
    basis: input.basis ?? 'order_date',
    statuses: [...new Set(input.status ?? [])],
    granularity: input.granularity ?? defaultGranularity(days),
  };
}

/** ISO weekday offset: Monday 0 … Sunday 6. */
function mondayOffset(date: string): number {
  return (new Date(utcMs(date)).getUTCDay() + 6) % 7;
}

/**
 * The first day of the bucket containing `date`: the date itself (day), the Monday on or before it (ISO
 * week), or the 1st of its month. Pure calendar arithmetic on YYYY-MM-DD (no time zone involved: the dates
 * are already India calendar dates). The first and last buckets of a range can be partial: a week bucket
 * may start before `from`, but only rows dated within the range are ever counted in it.
 */
export function bucketStart(date: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return date;
    case 'week':
      return addDays(date, -mondayOffset(date));
    case 'month':
      return `${date.slice(0, 7)}-01`;
  }
}

function nextBucket(start: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return addDays(start, 1);
    case 'week':
      return addDays(start, 7);
    case 'month': {
      const [y, m] = start.split('-').map(Number);
      const year = m === 12 ? y + 1 : y;
      const month = m === 12 ? 1 : m + 1;
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }
}

/** Every bucket start from the bucket of `from` to the bucket of `to`, oldest first (none skipped). */
export function bucketStarts(
  from: string,
  to: string,
  granularity: Granularity,
): string[] {
  const starts: string[] = [];
  const last = bucketStart(to, granularity);
  for (
    let start = bucketStart(from, granularity);
    start <= last;
    start = nextBucket(start, granularity)
  ) {
    starts.push(start);
  }
  return starts;
}

/**
 * The same bucket in SQL, for a DATE expression `dateExpr` (a column of a derived table, evaluated once):
 * returned as 'YYYY-MM-DD' text so it compares equal to bucketStart().
 */
export function bucketSql(dateExpr: string, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return `CAST(${dateExpr} AS CHAR)`;
    case 'week':
      // WEEKDAY(): Monday = 0 … Sunday = 6 (ISO week starts on Monday).
      return `CAST(DATE_SUB(${dateExpr}, INTERVAL WEEKDAY(${dateExpr}) DAY) AS CHAR)`;
    case 'month':
      return `DATE_FORMAT(${dateExpr}, '%Y-%m-01')`;
  }
}
