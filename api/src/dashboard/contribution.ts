/**
 * Estimated contribution (Milestone 7 metric 6), computed exactly on DECIMAL strings (never a JS float):
 *
 *   "Estimated contribution = Settlement amount (3) − Product cost known (4) − Expenses (5).
 *    Settlement amount is Meesho's net figure (commission, shipping, returns, recoveries, TCS/TDS already
 *    reflected), so nothing else is deducted."
 *
 * Product cost here is the 2-dp `productCostKnown` (the number shown next to it), so the shown numbers add
 * up exactly. A missing (null = no rows) part counts as nothing; when all three are null the contribution is
 * null too (nothing to estimate).
 */
import { subtractDecimals } from './decimal-text';

export const CONTRIBUTION_FORMULA =
  'settlement amount − known product cost − expenses';

export function estimatedContribution(parts: {
  settlementAmount: string | null;
  productCostKnown: string | null;
  expenses: string | null;
}): string | null {
  return subtractDecimals(
    parts.settlementAmount,
    parts.productCostKnown,
    parts.expenses,
  );
}

/**
 * The "Incomplete because …" flags, each a count (0 = not raised):
 * - costUnknown: orders in scope whose product cost is unknown or that have no product;
 * - ordersWithoutSettlement: orders in scope with no matched, non-superseded entry (not settled yet, or
 *   unmatched);
 * - unmatchedSettlements: unmatched entries included in the settlement amount;
 * - pricesMissing: orders in scope without a discounted price;
 * - cancelledOrReturned: orders in scope (the product-cost orders) whose raw status says cancelled / RTO /
 *   returned (order-status-classes.ts): their known cost is still deducted ("count it, but warn").
 */
export interface ContributionFlags {
  costUnknown: number;
  ordersWithoutSettlement: number;
  unmatchedSettlements: number;
  pricesMissing: number;
  cancelledOrReturned: number;
}

/** `complete` = no flag raised. */
export function isComplete(flags: ContributionFlags): boolean {
  return (
    flags.costUnknown === 0 &&
    flags.ordersWithoutSettlement === 0 &&
    flags.unmatchedSettlements === 0 &&
    flags.pricesMissing === 0 &&
    flags.cancelledOrReturned === 0
  );
}
