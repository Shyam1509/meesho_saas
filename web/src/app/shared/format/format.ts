/**
 * Display formatting shared by every screen. A missing value (`null`, `undefined`, empty string)
 * is always shown as {@link MISSING} ("—"), never as 0, so "no data" and "zero" stay distinct.
 * Amounts arrive from the API as decimal strings; dates as ISO-8601 strings.
 */

/** Shown for a missing / not applicable value. Pair it with an `sr-only` "Not available" if needed. */
export const MISSING = '—';

const LOCALE = 'en-IN';

const inr = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrUpTo4 = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const count = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** A decimal string as the API sends it: optional `-`, digits, optional fraction. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** A calendar date without a time (`YYYY-MM-DD`). */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

function isMissing(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === '';
}

/**
 * Indian rupees with 2 decimals and Indian digit grouping: `"1234567.5"` → "₹12,34,567.50",
 * `"-250"` → "-₹250.00", `"0"` → "₹0.00". Missing → "—". A value that is not a number is shown
 * as it is rather than hidden.
 */
export function formatInr(value: string | number | null | undefined): string {
  if (isMissing(value)) {
    return MISSING;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? inr.format(value) : MISSING;
  }
  const trimmed = value.trim();
  return DECIMAL_PATTERN.test(trimmed) ? inr.format(Number(trimmed)) : value;
}

/**
 * A unit cost in rupees, keeping up to 4 decimals (the precision costs are entered with):
 * `"12.3456"` → "₹12.3456", `"250"` → "₹250.00", `"0"` → "₹0.00". Missing → "—".
 */
export function formatUnitCost(value: string | null | undefined): string {
  if (isMissing(value)) {
    return MISSING;
  }
  const trimmed = value.trim();
  return DECIMAL_PATTERN.test(trimmed) ? inrUpTo4.format(Number(trimmed)) : value;
}

/** Whole numbers with Indian grouping: 1234567 → "12,34,567"; 0 → "0"; missing → "—". */
export function formatCount(value: number | null | undefined): string {
  return isMissing(value) || !Number.isFinite(value) ? MISSING : count.format(value);
}

/**
 * A calendar date: "5 Oct 2026". A `YYYY-MM-DD` value is shown as that exact day (no time-zone
 * shift); a date-time is shown as its day in `timeZone` (default: the viewer's).
 */
export function formatDate(value: string | null | undefined, timeZone?: string): string {
  if (isMissing(value)) {
    return MISSING;
  }
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat(LOCALE, { ...DATE_OPTIONS, timeZone: 'UTC' }).format(utc);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(LOCALE, { ...DATE_OPTIONS, timeZone }).format(date);
}

/** A moment: "30 Oct 2026, 2:00 pm" in `timeZone` (default: the viewer's). Missing → "—". */
export function formatDateTime(value: string | null | undefined, timeZone?: string): string {
  if (isMissing(value)) {
    return MISSING;
  }
  if (DATE_ONLY_PATTERN.test(value)) {
    return formatDate(value);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(LOCALE, { ...DATE_TIME_OPTIONS, timeZone }).format(date);
}

/** "1 Oct 2026 – 31 Oct 2026", one side alone when the other is missing, "—" when both are. */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone?: string,
): string {
  if (isMissing(start) && isMissing(end)) {
    return MISSING;
  }
  if (isMissing(end) || start === end) {
    return formatDate(start, timeZone);
  }
  if (isMissing(start)) {
    return formatDate(end, timeZone);
  }
  return `${formatDate(start, timeZone)} – ${formatDate(end, timeZone)}`;
}

/** "512 bytes", "820.5 KB", "9.8 MB" (1 KB = 1024 bytes). Missing → "—". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (isMissing(bytes) || !Number.isFinite(bytes) || bytes < 0) {
    return MISSING;
  }
  if (bytes < 1024) {
    return `${count.format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  }
  if (bytes < 1024 * 1024) {
    return `${oneDecimal.format(bytes / 1024)} KB`;
  }
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`;
}

/** "1 row" / "3 rows". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.format(n)} ${n === 1 ? singular : pluralForm}`;
}

/** The calendar date of `date` in `timeZone` (e.g. `Asia/Kolkata`) as `YYYY-MM-DD`. */
export function dateStringInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Today's date in the viewer's time zone as `YYYY-MM-DD` (what `<input type="date">` uses). */
export function localDateString(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
