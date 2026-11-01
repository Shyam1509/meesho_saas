import {
  SETTLEMENT_ENTRY_TYPES,
  type SettlementEntryType,
} from '../database/models';
import type { ContributionFlags } from './contribution';
import type {
  EntryGroup,
  ExpenseGroup,
  OrderGroup,
  SettlementComponents,
} from './dashboard-queries';
import { roundHalfUp, sumDecimals } from './decimal-text';

/**
 * Adds up the grouped rows of dashboard-queries.ts EXACTLY (decimal strings, BigInt): the same function
 * builds a seller account's row (its groups) and the totals (every group), so Σ account rows = totals by
 * construction (product cost: Σ exact cost, rounded HALF-UP to 2 dp once per row / total).
 */

export interface OrderSummary {
  /** Order metrics (orders matching the status filter in the payment basis). */
  count: number;
  units: number;
  orderValueDiscounted: string | null;
  orderValueListed: string | null;
  pricesMissing: number;
  withoutSettlement: number;
  statusCounts: { status: string; count: number }[];
  /** Product cost (every group: the cost orders). */
  known: string | null;
  knownExact: string | null;
  ordersKnown: number;
  ordersCostUnknown: number;
  ordersNoProduct: number;
  /** Cost orders whose raw status says cancelled / RTO / returned, and their known cost (2 dp). */
  cancelledOrReturnedOrders: number;
  cancelledOrReturnedCost: string | null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Most first, then by status in byte order (what utf8mb4_bin sorts by). */
function byCountThenStatus(
  a: { status: string; count: number },
  b: { status: string; count: number },
): number {
  return (
    b.count - a.count ||
    Buffer.compare(Buffer.from(a.status, 'utf8'), Buffer.from(b.status, 'utf8'))
  );
}

export function summarizeOrders(groups: readonly OrderGroup[]): OrderSummary {
  const metric = groups.filter((g) => g.statusMatch);
  const statuses = new Map<string, number>();
  for (const g of metric) {
    statuses.set(g.status, (statuses.get(g.status) ?? 0) + g.count);
  }
  const knownExact = sumDecimals(groups.map((g) => g.costExact));
  const cancelled = groups.filter((g) => g.cancelledOrReturned);
  return {
    count: sum(metric.map((g) => g.count)),
    units: sum(metric.map((g) => g.units)),
    orderValueDiscounted: sumDecimals(
      metric.map((g) => g.orderValueDiscounted),
    ),
    orderValueListed: sumDecimals(metric.map((g) => g.orderValueListed)),
    pricesMissing: sum(metric.map((g) => g.pricesMissing)),
    withoutSettlement: sum(metric.map((g) => g.withoutSettlement)),
    statusCounts: [...statuses]
      .map(([status, count]) => ({ status, count }))
      .sort(byCountThenStatus),
    known: roundHalfUp(knownExact, 2),
    knownExact,
    ordersKnown: sum(groups.map((g) => g.ordersKnown)),
    ordersCostUnknown: sum(groups.map((g) => g.ordersCostUnknown)),
    ordersNoProduct: sum(groups.map((g) => g.ordersNoProduct)),
    cancelledOrReturnedOrders: sum(cancelled.map((g) => g.count)),
    cancelledOrReturnedCost: roundHalfUp(
      sumDecimals(cancelled.map((g) => g.costExact)),
      2,
    ),
  };
}

export interface EntrySummary {
  amount: string | null;
  count: number;
  unmatched: number;
  components: SettlementComponents;
  /** Every entry type, always in the same order (amount null, count 0 when none). */
  byType: {
    entryType: SettlementEntryType;
    amount: string | null;
    count: number;
  }[];
}

const COMPONENT_KEYS = [
  'sale',
  'return',
  'commission',
  'shipping',
  'tcs',
  'tds',
  'recovery',
  'compensation',
] as const satisfies readonly (keyof SettlementComponents)[];

export function summarizeEntries(groups: readonly EntryGroup[]): EntrySummary {
  const components = Object.fromEntries(
    COMPONENT_KEYS.map((key) => [
      key,
      sumDecimals(groups.map((g) => g.components[key])),
    ]),
  ) as unknown as SettlementComponents;
  return {
    amount: sumDecimals(groups.map((g) => g.amount)),
    count: sum(groups.map((g) => g.count)),
    unmatched: sum(groups.map((g) => g.unmatched)),
    components,
    byType: SETTLEMENT_ENTRY_TYPES.map((entryType) => {
      const ofType = groups.filter((g) => g.entryType === entryType);
      return {
        entryType,
        amount: sumDecimals(ofType.map((g) => g.amount)),
        count: sum(ofType.map((g) => g.count)),
      };
    }),
  };
}

export interface ExpenseSummary {
  amount: string | null;
  count: number;
  /** Seller-account expenses. */
  accountAmount: string | null;
  /** Workspace-wide expenses (no seller account). */
  workspaceAmount: string | null;
}

export function summarizeExpenses(
  groups: readonly ExpenseGroup[],
): ExpenseSummary {
  return {
    amount: sumDecimals(groups.map((g) => g.amount)),
    count: sum(groups.map((g) => g.count)),
    accountAmount: sumDecimals(
      groups.filter((g) => g.accountId !== null).map((g) => g.amount),
    ),
    workspaceAmount: sumDecimals(
      groups.filter((g) => g.accountId === null).map((g) => g.amount),
    ),
  };
}

/** The "Incomplete because …" flags of a scope (or one account). */
export function flagsOf(
  orders: OrderSummary,
  entries: EntrySummary,
): ContributionFlags {
  return {
    costUnknown: orders.ordersCostUnknown + orders.ordersNoProduct,
    ordersWithoutSettlement: orders.withoutSettlement,
    unmatchedSettlements: entries.unmatched,
    pricesMissing: orders.pricesMissing,
    cancelledOrReturned: orders.cancelledOrReturnedOrders,
  };
}

/** One trend point (metric 7), as DashboardTrendPointDto. */
export interface TrendPoint {
  bucketStart: string;
  orders: number;
  orderValueDiscounted: string | null;
  settlementAmount: string | null;
  productCostKnown: string | null;
  expenses: string | null;
}

/**
 * Every bucket of the range from the same grouped rows as the totals: orders / order value of the order
 * metrics, known product cost (Σ exact, rounded HALF-UP to 2 dp per bucket), settlement amount, expenses.
 * A bucket without rows has 0 orders and null sums (a gap, never a made-up 0.00); a group in a bucket that is
 * not in `starts` is a bug and throws (never dropped silently).
 */
export function trendFromGroups(
  starts: readonly string[],
  groups: {
    orders: readonly OrderGroup[];
    entries: readonly EntryGroup[];
    expenses: readonly ExpenseGroup[];
  },
): TrendPoint[] {
  const known = new Set(starts);
  for (const g of [...groups.orders, ...groups.entries, ...groups.expenses]) {
    if (!known.has(g.bucket)) throw new Error('unexpected trend bucket');
  }
  return starts.map((bucketStart) => {
    const orders = groups.orders.filter((g) => g.bucket === bucketStart);
    const metric = orders.filter((g) => g.statusMatch);
    return {
      bucketStart,
      orders: sum(metric.map((g) => g.count)),
      orderValueDiscounted: sumDecimals(
        metric.map((g) => g.orderValueDiscounted),
      ),
      settlementAmount: sumDecimals(
        groups.entries
          .filter((g) => g.bucket === bucketStart)
          .map((g) => g.amount),
      ),
      productCostKnown: roundHalfUp(
        sumDecimals(orders.map((g) => g.costExact)),
        2,
      ),
      expenses: sumDecimals(
        groups.expenses
          .filter((g) => g.bucket === bucketStart)
          .map((g) => g.amount),
      ),
    };
  });
}
