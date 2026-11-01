import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { whereClause, type SqlFilter } from '../common/sql/account-scope';
import { moneyOrNull, toBool, toCount } from '../common/sql/values';
import type { SettlementEntryType } from '../database/models';
import {
  accountExpenseScope,
  addExpenseFilters,
  workspaceExpenseScope,
} from '../expenses/expense-queries';
import {
  orderFirstPaymentJoin,
  orderScope,
  STATUS_IN_SQL,
  workspaceOrderScope,
} from '../orders/order-queries';
import { cancelledOrReturnedSql } from '../orders/order-status-classes';
import { addOrderListFilters } from '../orders/orders.service';
import {
  ORDER_COST_STATE_SQL,
  ORDER_COST_TOTAL_SQL,
  orderCostRangesJoin,
} from '../products/effective-cost';
import {
  addEntryDateRange,
  entryBasisDateSql,
  entryBasisJoin,
  entryScope,
  entryUndatedSql,
  MATCH_STATE_SQL,
  NOT_SUPERSEDED_SQL,
  workspaceEntryScope,
} from '../settlements/settlement-entry-queries';
import { bucketSql, type ResolvedDashboardFilters } from './dashboard-range';

/**
 * SQL of the Milestone 7 dashboard. Every row set is selected through the SAME filter builders as the lists
 * (one number, one source): orders through addOrderListFilters (GET .../orders), settlement entries through
 * addEntryDateRange + NOT_SUPERSEDED_SQL (GET .../settlements), expenses through addExpenseFilters
 * (GET .../expenses), product costs by the effective-cost rule (effective-cost.ts). Each table is read ONCE
 * per dashboard, grouped by seller account (and raw status / entry type); the service adds the groups up
 * exactly (decimal-text.ts) for the account rows, the totals, the status counts and the type breakdown.
 * All sums are MySQL DECIMAL sums returned as text; a sum over no row (or over NULLs only) is NULL.
 */

/** Whose data: one seller account, or every account of a workspace (+ its workspace-wide expenses). */
export type MetricScope =
  | { kind: 'account'; workspaceId: number; sellerAccountId: number }
  | { kind: 'workspace'; workspaceId: number };

function orderBase(scope: MetricScope): SqlFilter {
  return scope.kind === 'account'
    ? orderScope(scope)
    : workspaceOrderScope(scope.workspaceId);
}

function entryBase(scope: MetricScope): SqlFilter {
  return scope.kind === 'account'
    ? entryScope(scope)
    : workspaceEntryScope(scope.workspaceId);
}

/** `products hp` of the scope, for the cost ranges. */
function productScopeSql(scope: MetricScope): string {
  return scope.kind === 'account'
    ? 'hp.seller_account_id = :sellerAccountId'
    : 'hp.workspace_id = :workspaceId';
}

/**
 * "Orders in scope" (metric definitions):
 * - `order_date` basis: orders with `order_date` in range (and status filter);
 * - `payment_date` basis: orders that have at least one matched, non-superseded settlement entry, and whose
 *   EARLIEST matched non-superseded entry `payment_date` is in range (each order counted in exactly one
 *   period) — the orders list's `paymentFrom` / `paymentTo`.
 * `withStatus`: whether the status filter narrows the rows (see costFilter).
 */
export function orderFilter(
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
  withStatus = true,
): SqlFilter {
  const status = withStatus ? filters.statuses : undefined;
  return addOrderListFilters(
    orderBase(scope),
    filters.basis === 'order_date'
      ? { status, from: filters.from, to: filters.to }
      : { status, paymentFrom: filters.from, paymentTo: filters.to },
  );
}

/** Payment basis with a status filter: the order metrics count only orders with one of those statuses. */
function orderMetricsNeedStatus(filters: ResolvedDashboardFilters): boolean {
  return filters.basis === 'payment_date' && filters.statuses.length > 0;
}

/**
 * The orders the dashboard reads: the product-cost orders (metric 4 "orders in scope"). With the status
 * filter in the order-date basis; in the payment-date basis the status filter applies to the order metrics
 * only (statusMatchSql), so costs cover the same orders as the settlement amount (which a status filter does
 * not narrow in that basis). Grouped by raw status, so a status rule for costs (the cancelled / returned
 * warning) is a classification of those groups.
 */
export function costFilter(
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
): SqlFilter {
  const filter = orderFilter(scope, filters, filters.basis === 'order_date');
  if (orderMetricsNeedStatus(filters)) {
    filter.replacements.statuses = filters.statuses;
  }
  return filter;
}

/** Per row: 1 when the order counts in the order metrics (always, unless orderMetricsNeedStatus). */
export function statusMatchSql(filters: ResolvedDashboardFilters): string {
  return orderMetricsNeedStatus(filters) ? `(${STATUS_IN_SQL})` : '1';
}

/**
 * Settlement entries in scope (metric 3), non-superseded:
 * - `order_date` basis: entries matched to an order in scope + unmatched entries whose own `order_date` is in
 *   range + account-level entries (no sub order) whose `payment_date` is in range; with a status filter,
 *   matched entries only of orders with one of those statuses (unmatched / account-level entries have no
 *   order status and stay);
 * - `payment_date` basis: entries whose `payment_date` is in range (no status filter).
 */
export function entryFilter(
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
): SqlFilter {
  const filter = entryBase(scope);
  filter.conditions.push(NOT_SUPERSEDED_SQL);
  addEntryDateRange(
    filter,
    filters.basis,
    filters,
    filters.basis === 'order_date' ? filters.statuses : [],
  );
  return filter;
}

/**
 * "Entries that lack the date the basis needs" (excluded from every sum, counted as undatedEntries,
 * regardless of the date range).
 */
export function undatedEntryFilter(
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
): SqlFilter {
  const filter = entryBase(scope);
  filter.conditions.push(NOT_SUPERSEDED_SQL, entryUndatedSql(filters.basis));
  return filter;
}

/**
 * Metric 5: expense `amount` with `expense_date` in range (regardless of basis): one account's expenses,
 * or every expense of the workspace (account expenses + workspace-wide ones).
 */
export function expenseFilter(
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
): SqlFilter {
  const base =
    scope.kind === 'account'
      ? accountExpenseScope({
          id: scope.sellerAccountId,
          workspaceId: scope.workspaceId,
        })
      : workspaceExpenseScope(scope.workspaceId, 'all');
  return addExpenseFilters(base, { from: filters.from, to: filters.to });
}

type Row = Record<string, unknown>;

async function select(
  sequelize: Sequelize,
  sql: string,
  filter: SqlFilter,
  transaction: Transaction,
): Promise<Row[]> {
  return sequelize.query<Row>(sql, {
    type: QueryTypes.SELECT,
    replacements: filter.replacements,
    transaction,
  });
}

// ---- Orders and their product cost (metrics 1, 2, 4, 7; flags) — one scan ----

/** The orders of one seller account with one raw status (exact, binary) in one trend bucket. */
export interface OrderGroup {
  accountId: string;
  status: string;
  bucket: string;
  /** Counted in the order metrics (false only for a status outside the filter, payment basis). */
  statusMatch: boolean;
  /** The status says cancelled / RTO / returned (order-status-classes.ts). */
  cancelledOrReturned: boolean;
  count: number;
  units: number;
  orderValueDiscounted: string | null;
  orderValueListed: string | null;
  pricesMissing: number;
  withoutSettlement: number;
  /** Σ exact (4 dp) cost of the group's orders whose cost is known. */
  costExact: string | null;
  ordersKnown: number;
  ordersCostUnknown: number;
  ordersNoProduct: number;
}

/**
 * The cost orders grouped by account, raw status and trend bucket (the order's own date per basis: order
 * date, or first payment date). `fp` (orderFirstPaymentJoin) gives "has a settlement" and the first payment
 * date from one materialised grouping; `pc` (orderCostRangesJoin) the cost effective on the order date.
 */
export async function orderGroups(
  sequelize: Sequelize,
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
  transaction: Transaction,
): Promise<OrderGroup[]> {
  const filter = costFilter(scope, filters);
  const date =
    filters.basis === 'order_date' ? 'o.order_date' : 'fp.first_payment';
  const rows = await select(
    sequelize,
    `SELECT o.seller_account_id AS accountId, o.current_status COLLATE utf8mb4_bin AS status,
            ${bucketSql(date, filters.granularity)} AS bucket,
            MAX(${statusMatchSql(filters)}) AS statusMatch,
            MAX(${cancelledOrReturnedSql('o')}) AS cancelledOrReturned,
            COUNT(*) AS count, SUM(o.quantity) AS units,
            CAST(SUM(o.supplier_discounted_price) AS CHAR) AS orderValueDiscounted,
            CAST(SUM(o.supplier_listed_price) AS CHAR) AS orderValueListed,
            COUNT(CASE WHEN o.supplier_discounted_price IS NULL THEN 1 END) AS pricesMissing,
            COUNT(CASE WHEN fp.order_id IS NULL THEN 1 END) AS withoutSettlement,
            CAST(SUM(${ORDER_COST_TOTAL_SQL}) AS CHAR) AS costExact,
            COUNT(CASE WHEN ${ORDER_COST_STATE_SQL} = 'known' THEN 1 END) AS ordersKnown,
            COUNT(CASE WHEN ${ORDER_COST_STATE_SQL} = 'unknown' THEN 1 END) AS ordersCostUnknown,
            COUNT(CASE WHEN ${ORDER_COST_STATE_SQL} = 'no_product' THEN 1 END) AS ordersNoProduct
       FROM orders o
       ${orderFirstPaymentJoin(scope.kind === 'account')}
       ${orderCostRangesJoin(productScopeSql(scope))}
       ${whereClause(filter)}
       GROUP BY o.seller_account_id, o.current_status COLLATE utf8mb4_bin, bucket`,
    filter,
    transaction,
  );
  return rows.map((row) => ({
    accountId: String(row.accountId as number | string),
    status: String(row.status as string),
    bucket: String(row.bucket as string),
    statusMatch: toBool(row.statusMatch),
    cancelledOrReturned: toBool(row.cancelledOrReturned),
    count: toCount(row.count),
    units: toCount(row.units),
    orderValueDiscounted: moneyOrNull(row.orderValueDiscounted),
    orderValueListed: moneyOrNull(row.orderValueListed),
    pricesMissing: toCount(row.pricesMissing),
    withoutSettlement: toCount(row.withoutSettlement),
    costExact: moneyOrNull(row.costExact),
    ordersKnown: toCount(row.ordersKnown),
    ordersCostUnknown: toCount(row.ordersCostUnknown),
    ordersNoProduct: toCount(row.ordersNoProduct),
  }));
}

// ---- Settlements (metrics 3, 7) — one scan ----

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

/** The entries in scope of one seller account and one entry type in one trend bucket. */
export interface EntryGroup {
  accountId: string;
  entryType: SettlementEntryType;
  bucket: string;
  count: number;
  amount: string | null;
  unmatched: number;
  components: SettlementComponents;
}

export async function entryGroups(
  sequelize: Sequelize,
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
  transaction: Transaction,
): Promise<EntryGroup[]> {
  const filter = entryFilter(scope, filters);
  const rows = await select(
    sequelize,
    `SELECT se.seller_account_id AS accountId, se.entry_type AS entryType,
            ${bucketSql(entryBasisDateSql(filters.basis), filters.granularity)} AS bucket,
            COUNT(*) AS count, CAST(SUM(se.settlement_amount) AS CHAR) AS amount,
            COUNT(CASE WHEN ${MATCH_STATE_SQL.unmatched} THEN 1 END) AS unmatched,
            CAST(SUM(se.sale_amount) AS CHAR) AS sale, CAST(SUM(se.return_amount) AS CHAR) AS returned,
            CAST(SUM(se.commission_amount) AS CHAR) AS commission,
            CAST(SUM(se.shipping_charge) AS CHAR) AS shipping,
            CAST(SUM(se.tcs_amount) AS CHAR) AS tcs, CAST(SUM(se.tds_amount) AS CHAR) AS tds,
            CAST(SUM(se.recovery_amount) AS CHAR) AS recovery,
            CAST(SUM(se.compensation_amount) AS CHAR) AS compensation
       FROM settlement_entries se
       ${entryBasisJoin(filters.basis)}
       ${whereClause(filter)}
       GROUP BY se.seller_account_id, se.entry_type, bucket`,
    filter,
    transaction,
  );
  return rows.map((row) => ({
    accountId: String(row.accountId as number | string),
    entryType: row.entryType as SettlementEntryType,
    bucket: String(row.bucket as string),
    count: toCount(row.count),
    amount: moneyOrNull(row.amount),
    unmatched: toCount(row.unmatched),
    components: {
      sale: moneyOrNull(row.sale),
      return: moneyOrNull(row.returned),
      commission: moneyOrNull(row.commission),
      shipping: moneyOrNull(row.shipping),
      tcs: moneyOrNull(row.tcs),
      tds: moneyOrNull(row.tds),
      recovery: moneyOrNull(row.recovery),
      compensation: moneyOrNull(row.compensation),
    },
  }));
}

/** Non-superseded entries of the scope without the basis date, regardless of the date range. */
export async function undatedEntries(
  sequelize: Sequelize,
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
  transaction: Transaction,
): Promise<number> {
  const filter = undatedEntryFilter(scope, filters);
  const [row] = await select(
    sequelize,
    `SELECT COUNT(*) AS total FROM settlement_entries se ${whereClause(filter)}`,
    filter,
    transaction,
  );
  return toCount(row?.total);
}

// ---- Expenses (metrics 5, 7) — one scan ----

/** Expenses of one seller account, or (accountId null) the workspace-wide ones, in one trend bucket. */
export interface ExpenseGroup {
  accountId: string | null;
  bucket: string;
  count: number;
  amount: string | null;
}

export async function expenseGroups(
  sequelize: Sequelize,
  scope: MetricScope,
  filters: ResolvedDashboardFilters,
  transaction: Transaction,
): Promise<ExpenseGroup[]> {
  const filter = expenseFilter(scope, filters);
  const rows = await select(
    sequelize,
    `SELECT e.seller_account_id AS accountId, ${bucketSql('e.expense_date', filters.granularity)} AS bucket,
            COUNT(*) AS count, CAST(SUM(e.amount) AS CHAR) AS amount
       FROM expenses e ${whereClause(filter)}
       GROUP BY e.seller_account_id, bucket`,
    filter,
    transaction,
  );
  return rows.map((row) => ({
    accountId:
      row.accountId === null || row.accountId === undefined
        ? null
        : String(row.accountId as number | string),
    bucket: String(row.bucket as string),
    count: toCount(row.count),
    amount: moneyOrNull(row.amount),
  }));
}

// ---- Accounts (workspace comparison) ----

export interface AccountRow {
  id: string;
  displayName: string;
  status: string;
}

/** Every seller account of the workspace, disabled ones included, by name then id. */
export async function workspaceAccounts(
  sequelize: Sequelize,
  workspaceId: number,
  transaction: Transaction,
): Promise<AccountRow[]> {
  const rows = await sequelize.query<{
    id: number | string;
    displayName: string;
    status: string;
  }>(
    `SELECT a.id, a.display_name AS displayName, a.status
       FROM seller_accounts a
       WHERE a.workspace_id = :workspaceId
       ORDER BY a.display_name ASC, a.id ASC`,
    { type: QueryTypes.SELECT, replacements: { workspaceId }, transaction },
  );
  return rows.map((r) => ({
    id: String(r.id),
    displayName: r.displayName,
    status: r.status,
  }));
}
