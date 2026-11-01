import { SellerAccountStatus } from '../seller-accounts/seller-account.models';

/**
 * The dashboard (`GET /accounts/:accountId/dashboard`, `GET /workspaces/:workspaceId/dashboard`).
 * Read-only sums over the imported data. Amounts are decimal strings AS REPORTED, `null` when no
 * row was summed (never 0); counts are numbers. The metric definitions below are the single source
 * of truth for the help text on screen.
 */

/**
 * `order_date`: orders whose order date is in the range, with their settlements and costs.
 * `payment_date`: orders whose EARLIEST matched, non-superseded settlement entry was paid in the
 * range (each order counted in exactly one period), and settlement entries paid in the range.
 */
export type DashboardBasis = 'order_date' | 'payment_date';

export const DASHBOARD_BASES: readonly DashboardBasis[] = ['order_date', 'payment_date'];

export const DEFAULT_DASHBOARD_BASIS: DashboardBasis = 'order_date';

/** Trend buckets: days, ISO weeks (starting Monday) or calendar months. */
export type TrendGranularity = 'day' | 'week' | 'month';

export const TREND_GRANULARITIES: readonly TrendGranularity[] = ['day', 'week', 'month'];

/** Query of both dashboard endpoints. Only the given values are sent. */
export interface DashboardQuery {
  /** `YYYY-MM-DD`, inclusive. The API's default: the last 30 days ending today (IST). */
  from?: string;
  to?: string;
  basis?: DashboardBasis;
  /** Raw order statuses; sent as a repeated `status` parameter. */
  status?: readonly string[];
  /** Left out: the API picks day (≤ 62 days), week (≤ 366 days) or month. */
  granularity?: TrendGranularity;
}

export interface DashboardScope {
  kind: 'account' | 'workspace';
  id: string;
  name: string;
}

/** The filters the API applied (its defaults filled in). */
export interface DashboardFilters {
  from: string;
  to: string;
  basis: DashboardBasis;
  statuses: string[];
  granularity: TrendGranularity;
}

export interface DashboardStatusCount {
  status: string;
  count: number;
}

export interface DashboardOrders {
  /** Orders in scope. */
  count: number;
  /** Σ quantity of the orders in scope. */
  units: number | null;
  /** Orders in scope grouped by Meesho's raw current status. */
  statusCounts: DashboardStatusCount[];
  /** Σ supplier discounted price, as reported (per unit or per order line: not confirmed yet). */
  orderValueDiscounted: string | null;
  /** Σ supplier listed price, as reported. */
  orderValueListed: string | null;
  /** Orders in scope without a reported discounted price (left out of the sum, never 0). */
  pricesMissing: number;
}

export interface DashboardEntryTypeTotal {
  entryType: string;
  amount: string | null;
  count: number;
}

/** Informational sums over the same entries; already included in the settlement amount. */
export interface SettlementComponents {
  sale: string | null;
  return: string | null;
  commission: string | null;
  shipping: string | null;
  tcs: string | null;
  tds: string | null;
  recovery: string | null;
  compensation: string | null;
}

export interface DashboardSettlements {
  /** Σ settlement amount of the non-superseded entries in scope, as reported. */
  amount: string | null;
  count: number;
  /** Entries without the date the basis needs: left out of every sum. */
  undatedEntries: number;
  byType: DashboardEntryTypeTotal[];
  components: SettlementComponents;
}

export interface DashboardProductCost {
  /** Σ product cost of the orders in scope whose cost is known, rounded half-up to 2 decimals. */
  known: string | null;
  /** The same, exact (4 decimals). */
  knownExact: string | null;
  ordersKnown: number;
  /** Orders with a product but no unit cost on their order date. */
  ordersCostUnknown: number;
  /** Orders without a product (no SKU, or no product for the SKU yet). */
  ordersNoProduct: number;
  /**
   * Orders in scope whose raw status says cancelled, RTO or returned (see
   * {@link isCancelledOrReturned}); their known cost is still deducted.
   */
  cancelledOrReturnedOrders: number;
  /** Their known product cost, already included in `known` (`null` when none is known). */
  cancelledOrReturnedCost: string | null;
}

export interface DashboardExpenses {
  /** Σ expenses dated in the range (whatever the basis). */
  amount: string | null;
  count: number;
  /** Workspace dashboard: the seller accounts' expenses; account dashboard: that account's. */
  accountAmount: string | null;
  /** Workspace dashboard only: workspace-wide expenses (else `null`). */
  workspaceAmount: string | null;
}

/** Counts of what makes the estimated contribution incomplete (0 = not a reason). */
export interface ContributionFlags {
  costUnknown: number;
  ordersWithoutSettlement: number;
  unmatchedSettlements: number;
  pricesMissing: number;
  /** Cancelled / RTO / returned orders whose product cost is still deducted. */
  cancelledOrReturned: number;
}

export interface DashboardContribution {
  /** Settlement amount − known product cost − expenses. */
  amount: string | null;
  /** True when no flag is set. */
  complete: boolean;
  flags: ContributionFlags;
  formula: string;
}

/**
 * One trend bucket, each metric on its own date for the basis. Counts are 0 for an empty bucket;
 * sums are `null` when the bucket has no rows (drawn as a gap, never as 0).
 */
export interface TrendBucket {
  /** `YYYY-MM-DD`: the day, the Monday of the ISO week, or the 1st of the month. */
  bucketStart: string;
  orders: number;
  orderValueDiscounted: string | null;
  settlementAmount: string | null;
  productCostKnown: string | null;
  expenses: string | null;
}

/** One row of the account comparison (workspace dashboard only; disabled accounts included). */
export interface DashboardAccountRow {
  id: string;
  displayName: string;
  status: SellerAccountStatus;
  orders: number;
  orderValueDiscounted: string | null;
  settlementAmount: string | null;
  productCostKnown: string | null;
  expenses: string | null;
  contribution: string | null;
  complete: boolean;
  /** Cancelled / RTO / returned orders of the account (their cost is still deducted). */
  cancelledOrReturnedOrders: number;
}

export interface Dashboard {
  scope: DashboardScope;
  filters: DashboardFilters;
  orders: DashboardOrders;
  settlements: DashboardSettlements;
  productCost: DashboardProductCost;
  expenses: DashboardExpenses;
  contribution: DashboardContribution;
  trend: TrendBucket[];
  /** Workspace dashboard only. */
  accounts?: DashboardAccountRow[];
  /** ISO-8601 UTC. */
  generatedAt: string;
}

/** The API's rule: a raw status containing CANCEL, RTO or RETURN (any case). */
const CANCELLED_OR_RETURNED = /cancel|rto|return/i;

/** True for a raw order status the dashboard counts as cancelled, RTO or returned. */
export function isCancelledOrReturned(status: string): boolean {
  return CANCELLED_OR_RETURNED.test(status);
}

/** The longest range the API accepts, in days. */
export const MAX_DASHBOARD_RANGE_DAYS = 731;

// Help text: the metric definitions, shortened for the screen (never contradicting them).

export const BASIS_HELP: Record<DashboardBasis, string> = {
  order_date:
    'Orders placed in the range, with their settlements and product costs, whenever they were paid.',
  payment_date:
    'Orders whose first matched settlement entry was paid in the range (each order counted once), and settlement entries paid in the range.',
};

export const BASIS_LABELS: Record<DashboardBasis, string> = {
  order_date: 'By order date',
  payment_date: 'By payment date',
};

/** What the optional status filter narrows, per basis. */
export const STATUS_FILTER_HELP: Record<DashboardBasis, string> = {
  order_date:
    'Narrows orders, their settlements and costs; ads, referral, recovery, unmatched entries and expenses still count.',
  payment_date: 'Narrows only the order counts and order value.',
};

export const ORDER_VALUE_CAVEAT =
  'As reported by Meesho — whether this is per unit or per order line is not confirmed yet. Not sales or revenue.';

export const SETTLEMENT_AMOUNT_HELP =
  'Sum of the settlement amounts Meesho reported (superseded entries left out). It is Meesho’s net figure: commission, shipping, returns, recoveries and TCS/TDS are already reflected.';

export const PRODUCT_COST_HELP =
  'Unit cost effective on the order date × quantity, for orders whose cost is known.';

export const EXPENSES_HELP = 'Expenses dated in the range, whatever the date basis.';

export const CONTRIBUTION_FORMULA = 'Settlement amount − known product cost − expenses';

export const CONTRIBUTION_HELP =
  'The settlement amount is already net of Meesho’s deductions, so nothing else is subtracted.';

export const NOT_PAYOUT_NOTE = 'This is not a bank payout and not tax advice.';

export const COMPONENTS_NOTE = 'Already included in the settlement amount — not deducted again.';

export const TAX_NOTE = 'As reported by Meesho. Not tax advice or a filed liability.';

export const ACCOUNT_LEVEL_DATE_NOTE =
  'Account-level entries (ads, referral and other entries without a sub order) have no order date, so they are counted by payment date.';

/** The informational components in display order (TCS and TDS shown apart). */
export const SETTLEMENT_COMPONENTS: readonly { key: keyof SettlementComponents; label: string }[] =
  [
    { key: 'sale', label: 'Sale amount' },
    { key: 'return', label: 'Return amount' },
    { key: 'commission', label: 'Commission' },
    { key: 'shipping', label: 'Shipping charge' },
    { key: 'recovery', label: 'Recovery' },
    { key: 'compensation', label: 'Compensation' },
  ];

export const TAX_COMPONENTS: readonly { key: keyof SettlementComponents; label: string }[] = [
  { key: 'tcs', label: 'TCS' },
  { key: 'tds', label: 'TDS' },
];
