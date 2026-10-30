/**
 * Pure cell normalizers. Every function takes a raw cell (CSV: always a string; XLSX: what the cell
 * holds) and returns the normalised value, `null` for a blank cell (missing — never 0), or a reason.
 * Reasons never contain the cell value; callers prefix them with the column name.
 */

/** A cell as read from a file. XLSX formulas, rich text and hyperlinks are already reduced to a value. */
export type RawCell = string | number | boolean | Date | null;

export type Normalized<T> =
  { ok: true; value: T | null } | { ok: false; reason: string };

const ok = <T>(value: T | null): Normalized<T> => ({ ok: true, value });
const fail = <T>(reason: string): Normalized<T> => ({ ok: false, reason });

export const REASONS = {
  tooLong: (max: number) => `is longer than ${max} characters`,
  scientific:
    'looks like a number in scientific notation (e.g. 1.23E+17): format the column as text and export again',
  unsafeNumber:
    'is a number too long to read exactly: format the column as text and export again',
  notAnId: 'is not a valid identifier',
  notAmount: 'is not a valid amount',
  tooManyDecimals: 'has more than 2 decimal places',
  amountTooLarge: 'is too large (at most 9999999999.99)',
  quantity: 'must be a whole number greater than 0',
  date: 'is not a valid date (use DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD or DD Mon YYYY)',
  dateYear: 'has a year outside 2000–2100',
  required: 'is required',
} as const;

/** Lower-case a–z and 0–9 only: the form headers and sheet names are compared in. */
export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Trim and collapse internal whitespace (spaces, tabs, line breaks, NBSP). */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Removes Unicode format characters (category Cf: zero-width space / joiners, bidi controls, soft hyphen,
 * BOM). They are invisible, but would make "SO-1" and "SO-1" + U+200B different ids or spoof a file name.
 */
export function stripFormatChars(text: string): string {
  return text.replace(/\p{Cf}/gu, '');
}

/** Length in characters as MySQL counts them for utf8mb4 (code points, not UTF-16 units). */
function charLength(text: string): number {
  return [...text].length;
}

function isBlank(raw: RawCell): boolean {
  return (
    raw === null ||
    (typeof raw === 'string' && stripFormatChars(raw).trim() === '')
  );
}

/** YYYY-MM-DD of a Date's UTC parts (XLSX date cells are UTC). */
function isoDateOfUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Free text (names, states, sizes, ids, statuses): format characters removed, trimmed, whitespace
 * collapsed, at most `maxLength` characters.
 */
export function normalizeText(
  raw: RawCell,
  maxLength: number,
): Normalized<string> {
  if (isBlank(raw)) return ok(null);
  let text: string;
  if (typeof raw === 'string') {
    text = collapseWhitespace(stripFormatChars(raw));
    if (text === '') return ok(null);
  } else if (typeof raw === 'number') text = String(raw);
  else if (typeof raw === 'boolean') text = raw ? 'TRUE' : 'FALSE';
  else if (raw instanceof Date && !Number.isNaN(raw.getTime()))
    text = isoDateOfUtc(raw);
  else return fail(REASONS.notAnId);
  if (charLength(text) > maxLength) return fail(REASONS.tooLong(maxLength));
  return ok(text);
}

const SCIENTIFIC = /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i;

/**
 * Identifiers (sub-order no, SKU, transaction id, ...): like text, but a number in scientific notation
 * (what Excel does to long ids) or a number too big to be exact is an error, never silently rounded.
 */
export function normalizeId(
  raw: RawCell,
  maxLength: number,
): Normalized<string> {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) return fail(REASONS.notAnId);
    if (!Number.isSafeInteger(raw)) return fail(REASONS.unsafeNumber);
    return normalizeText(String(raw), maxLength);
  }
  if (typeof raw === 'boolean' || raw instanceof Date)
    return fail(REASONS.notAnId);
  const text = normalizeText(raw, maxLength);
  if (text.ok && text.value !== null && SCIENTIFIC.test(text.value)) {
    return fail(REASONS.scientific);
  }
  return text;
}

/** Raw source status: trimmed and whitespace-collapsed, case kept (normalisation of statuses is M5). */
export function normalizeStatus(raw: RawCell): Normalized<string> {
  return normalizeText(raw, 64);
}

/** DECIMAL(12,2): at most 10 integer digits. */
const MAX_INTEGER_DIGITS = 10;
const MAX_CENTS = 999_999_999_999;

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/**
 * XLSX numbers: accepted when they are an exact 2-dp amount up to a binary floating-point artefact
 * (|n − round(n, 2)| < 1e-9, e.g. 0.1 + 0.2); anything finer is an error, never rounded away.
 */
function decimalFromNumber(raw: number): Normalized<string> {
  if (!Number.isFinite(raw)) return fail(REASONS.notAmount);
  const cents = Math.round(raw * 100);
  if (Math.abs(raw - cents / 100) >= 1e-9) return fail(REASONS.tooManyDecimals);
  if (Math.abs(cents) > MAX_CENTS) return fail(REASONS.amountTooLarge);
  return ok(formatCents(cents === 0 ? 0 : cents));
}

const CURRENCY_PREFIX = /^(?:₹|rs\.?|inr)/i;
const AMOUNT = /^(\d+(?:,\d+)*)(?:\.(\d+))?$/;
/** Integer part with separators: Western (123,456,789) or Indian (1,23,45,678) grouping only. */
const WESTERN_GROUPING = /^\d{1,3}(?:,\d{3})+$/;
const INDIAN_GROUPING = /^\d{1,2}(?:,\d{2})*,\d{3}$/;

function validGrouping(integerPart: string): boolean {
  return (
    !integerPart.includes(',') ||
    WESTERN_GROUPING.test(integerPart) ||
    INDIAN_GROUPING.test(integerPart)
  );
}

/**
 * Money as reported → canonical 'd.dd' string (exact, never via a float). Strings may carry ₹ / Rs. / INR,
 * spaces and thousands separators in valid Indian (1,23,456.78) or Western (123,456.78) grouping — anything
 * else ("1,23", "12,5") is an error, never guessed — and one leading minus sign (before or after the
 * currency symbol). More than 2 decimals is an error unless the extra digits are zeros ("10.500" is exactly
 * 10.50). Blank → null (not reported), never 0.
 */
export function normalizeDecimal(raw: RawCell): Normalized<string> {
  if (raw === null) return ok(null);
  if (typeof raw === 'number') return decimalFromNumber(raw);
  if (typeof raw !== 'string') return fail(REASONS.notAmount);
  let text = stripFormatChars(raw).replace(/\s+/g, '');
  if (text === '') return ok(null);
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(CURRENCY_PREFIX, '');
  if (!negative && text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  const match = AMOUNT.exec(text);
  if (!match || !validGrouping(match[1])) return fail(REASONS.notAmount);
  const integerDigits = match[1].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  let fraction = match[2] ?? '';
  if (fraction.length > 2) {
    if (!/^0+$/.test(fraction.slice(2))) return fail(REASONS.tooManyDecimals);
    fraction = fraction.slice(0, 2);
  }
  if (integerDigits.length > MAX_INTEGER_DIGITS)
    return fail(REASONS.amountTooLarge);
  fraction = fraction.padEnd(2, '0');
  const isZero = /^0+$/.test(integerDigits) && fraction === '00';
  return ok(`${negative && !isZero ? '-' : ''}${integerDigits}.${fraction}`);
}

/** orders.quantity is INT UNSIGNED. */
const MAX_QUANTITY = 4_294_967_295;

/** Quantity: a whole number > 0 (as a string, like every stored source value). */
export function normalizeQuantity(raw: RawCell): Normalized<string> {
  if (isBlank(raw)) return ok(null);
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (
    typeof raw === 'string' &&
    /^\d+$/.test(stripFormatChars(raw).trim())
  ) {
    value = Number(stripFormatChars(raw).trim());
  } else {
    return fail(REASONS.quantity);
  }
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QUANTITY) {
    return fail(REASONS.quantity);
  }
  return ok(String(value));
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const FULL_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthFromName(name: string): number | null {
  const lower = name.toLowerCase();
  const short = MONTHS.indexOf(lower);
  if (short >= 0) return short + 1;
  const full = FULL_MONTHS.indexOf(lower);
  if (full >= 0) return full + 1;
  if (lower === 'sept') return 9;
  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): Normalized<string> {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return fail(REASONS.date);
  }
  if (year < 2000 || year > 2100) return fail(REASONS.dateYear);
  return ok(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** Day first, always (Indian order): 05/10/2026 is 5 October. Same separator twice. */
const DAY_FIRST = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})$/;
const DAY_MONTH_NAME = /^(\d{1,2})([ -])([A-Za-z]{3,9})\2(\d{4})$/;

/**
 * Dates → 'YYYY-MM-DD'. Accepted: YYYY-MM-DD, YYYY-MM-DD HH:mm[:ss] (time dropped), DD-MM-YYYY,
 * DD/MM/YYYY (never month first: 10/25/2026 is rejected, not read as 25 October), DD Mon YYYY /
 * DD-Mon-YYYY (month name or 3-letter abbreviation) and XLSX date cells (their UTC calendar date).
 * Anything else, impossible calendar dates and years outside 2000–2100 are errors.
 */
export function normalizeDate(raw: RawCell): Normalized<string> {
  if (isBlank(raw)) return ok(null);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fail(REASONS.date);
    return isoDate(
      raw.getUTCFullYear(),
      raw.getUTCMonth() + 1,
      raw.getUTCDate(),
    );
  }
  if (typeof raw !== 'string') return fail(REASONS.date);
  const text = stripFormatChars(raw).trim();

  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [hours, minutes, seconds] = [iso[4], iso[5], iso[6]].map((v) =>
      v === undefined ? 0 : Number(v),
    );
    if (hours > 23 || minutes > 59 || seconds > 59) return fail(REASONS.date);
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) {
    return isoDate(
      Number(dayFirst[4]),
      Number(dayFirst[3]),
      Number(dayFirst[1]),
    );
  }
  const named = DAY_MONTH_NAME.exec(text);
  if (named) {
    const month = monthFromName(named[3]);
    if (month === null) return fail(REASONS.date);
    return isoDate(Number(named[4]), month, Number(named[1]));
  }
  return fail(REASONS.date);
}

/**
 * How a raw cell is kept for an error row (so the user can find and fix it): the trimmed text, cut to
 * 255 characters. Mapped columns only — unmapped columns are never stored.
 */
export function displayRaw(raw: RawCell): string | null {
  if (raw === null) return null;
  let text: string;
  if (raw instanceof Date) {
    text = Number.isNaN(raw.getTime()) ? '' : raw.toISOString();
  } else {
    text = collapseWhitespace(stripFormatChars(String(raw)));
  }
  if (text === '') return null;
  const chars = [...text];
  return chars.length > 255 ? chars.slice(0, 255).join('') : text;
}
