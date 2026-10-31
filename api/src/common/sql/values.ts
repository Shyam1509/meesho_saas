/**
 * Raw-query value readers. mysql2 (as configured by Sequelize) returns DECIMAL as a string, COUNT as a
 * number and boolean expressions / TINYINT(1) as numbers; these keep the mapping explicit and tolerant.
 */

/** DECIMAL money as the exact decimal string MySQL returned; null stays null (= not reported). */
export function moneyOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  // Defensive only: a numeric DECIMAL would mean decimalNumbers was switched on (never in this app).
  throw new Error('DECIMAL value was not returned as a string');
}

export function toCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error('count is not a non-negative integer');
  }
  return n;
}

export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value) === 1;
}

/** A BIGINT id (number, or string when beyond 2^53) as a string; null stays null. */
export function idOrNull(
  value: number | string | null | undefined,
): string | null {
  return value === null || value === undefined ? null : String(value);
}
