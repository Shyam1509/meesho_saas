/**
 * Exact arithmetic on DECIMAL strings as MySQL returns them ("-420.00", "986.6666"), on scaled BigInts:
 * never a JS float. Used to add up per-account / per-group sums (one scan, exact totals) and for the
 * estimated contribution.
 */

const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

function parse(value: string): {
  negative: boolean;
  digits: string;
  scale: number;
} {
  const match = DECIMAL_TEXT.exec(value);
  if (!match) throw new Error('not a decimal string');
  const [, sign, integer, fraction = ''] = match;
  return {
    negative: sign === '-',
    digits: integer + fraction,
    scale: fraction.length,
  };
}

/** Decimals of a decimal string. */
export function scaleOf(value: string): number {
  return parse(value).scale;
}

/** `value` × 10^scale as a BigInt; refuses a value with more decimals than `scale` (never rounds). */
export function toScaled(value: string, scale: number): bigint {
  const p = parse(value);
  if (p.scale > scale) throw new Error('more decimals than the scale');
  const digits = BigInt(p.digits + '0'.repeat(scale - p.scale));
  return p.negative ? -digits : digits;
}

/** A scaled BigInt back to decimal text with exactly `scale` decimals ("-0.50", "12.00"). */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const text = scale > 0 ? `${integer}.${fraction}` : integer;
  return negative ? `-${text}` : text;
}

/** Σ of the non-null values, exactly, at the largest scale among them; null when every value is null. */
export function sumDecimals(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null);
  if (present.length === 0) return null;
  const scale = Math.max(...present.map(scaleOf));
  return fromScaled(
    present.reduce((acc, v) => acc + toScaled(v, scale), 0n),
    scale,
  );
}

/** first − each of `rest`, exactly; null parts count as 0; null when every part is null. Scale ≥ 2. */
export function subtractDecimals(
  first: string | null,
  ...rest: (string | null)[]
): string | null {
  const parts = [first, ...rest];
  const present = parts.filter((p): p is string => p !== null);
  if (present.length === 0) return null;
  const scale = Math.max(2, ...present.map(scaleOf));
  const [head, ...tail] = parts.map((p) =>
    p === null ? 0n : toScaled(p, scale),
  );
  return fromScaled(
    tail.reduce((acc, v) => acc - v, head),
    scale,
  );
}

/**
 * Rounds to `scale` decimals, half away from zero — what MySQL's ROUND() does on an exact DECIMAL
 * (HALF-UP for the non-negative product costs): "999.9999" → "1000.00", "986.6650" → "986.67".
 */
export function roundHalfUp(
  value: string | null,
  scale: number,
): string | null {
  if (value === null) return null;
  const from = scaleOf(value);
  if (from <= scale)
    return fromScaled(
      toScaled(value, from) * 10n ** BigInt(scale - from),
      scale,
    );
  const scaled = toScaled(value, from);
  const divisor = 10n ** BigInt(from - scale);
  const magnitude = scaled < 0n ? -scaled : scaled;
  let quotient = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) quotient += 1n;
  return fromScaled(scaled < 0n ? -quotient : quotient, scale);
}
