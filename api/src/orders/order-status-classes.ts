/**
 * Cancelled / returned orders (Milestone 7, "count it, but warn"): an order whose raw `current_status`
 * contains, case-insensitively, one of these keywords. A keyword match until the real Meesho statuses are
 * confirmed (raw statuses are not normalised: "Cancelled", "RTO_DELIVERED", "Return Requested" all match;
 * "DELIVERED", "SHIPPED" do not). Their known product cost is still deducted; the dashboard reports them and
 * marks the estimated contribution incomplete. The SQL fragment and the JS twin are built from this list.
 */
export const CANCELLED_OR_RETURNED_KEYWORDS = [
  'CANCEL',
  'RTO',
  'RETURN',
] as const;

for (const keyword of CANCELLED_OR_RETURNED_KEYWORDS) {
  // They are written into SQL as literals: our own constants, A–Z only.
  if (!/^[A-Z]+$/.test(keyword)) throw new Error('unsafe status keyword');
}

/**
 * The classification in SQL on `orders <alias>`: UPPER() then LIKE, so it does not depend on the column
 * collation. 1 = cancelled / returned.
 */
export function cancelledOrReturnedSql(alias = 'o'): string {
  return `(${CANCELLED_OR_RETURNED_KEYWORDS.map(
    (k) => `UPPER(${alias}.current_status) LIKE '%${k}%'`,
  ).join(' OR ')})`;
}

const KEYWORD_PATTERN = new RegExp(
  CANCELLED_OR_RETURNED_KEYWORDS.join('|'),
  'i',
);

/** The same rule in JS (documentation, unit tests and any client-side display). */
export function isCancelledOrReturned(status: string): boolean {
  return KEYWORD_PATTERN.test(status);
}
