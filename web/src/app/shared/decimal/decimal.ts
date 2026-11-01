/**
 * Exact arithmetic on the API's decimal strings (`"-1234.50"`), for client-side totals: no
 * floating-point rounding, and `null` (missing) is never treated as 0.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

interface Scaled {
  value: bigint;
  scale: number;
}

function parse(value: string): Scaled | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) {
    return null;
  }
  const fraction = match[3] ?? '';
  const digits = BigInt(match[2] + fraction);
  return { value: match[1] ? -digits : digits, scale: fraction.length };
}

function rescale(n: Scaled, scale: number): bigint {
  return n.value * 10n ** BigInt(scale - n.scale);
}

function format(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** True for a decimal string the helpers can read. */
export function isDecimal(value: string | null | undefined): value is string {
  return typeof value === 'string' && DECIMAL.test(value.trim());
}

/**
 * The exact sum of the given decimal strings, skipping `null` / unreadable values, with at least
 * 2 decimals; `null` when there is nothing to add (all missing), so "no data" stays distinct from
 * a real `"0.00"`.
 */
export function sumDecimals(values: readonly (string | null | undefined)[]): string | null {
  const parsed = values.filter(isDecimal).map((v) => parse(v) as Scaled);
  if (parsed.length === 0) {
    return null;
  }
  const scale = Math.max(2, ...parsed.map((p) => p.scale));
  const total = parsed.reduce((sum, p) => sum + rescale(p, scale), 0n);
  return format(total, scale);
}

/** `"12.50"` → `"-12.50"`; `"0.00"` stays `"0.00"`; missing / unreadable → `null`. */
export function negateDecimal(value: string | null | undefined): string | null {
  if (!isDecimal(value)) {
    return null;
  }
  const p = parse(value) as Scaled;
  const scale = Math.max(2, p.scale);
  return format(-rescale(p, scale), scale);
}

/**
 * Compares two decimal strings numerically (-1, 0, 1) for sorting. A missing or unreadable value
 * counts as larger than every number; callers that keep missing values last in both directions
 * handle them before calling this.
 */
export function compareDecimals(a: string | null | undefined, b: string | null | undefined): number {
  const pa = isDecimal(a) ? parse(a) : null;
  const pb = isDecimal(b) ? parse(b) : null;
  if (pa === null || pb === null) {
    return pa === pb ? 0 : pa === null ? 1 : -1;
  }
  const scale = Math.max(pa.scale, pb.scale);
  const diff = rescale(pa, scale) - rescale(pb, scale);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}
