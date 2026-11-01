import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { parseSort } from '../common/http/list-query';
import { isoTimestamp, toImportRef } from '../common/http/refs.dto';
import {
  whereClause,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { idOrNull, moneyOrNull, toCount } from '../common/sql/values';
import {
  ORDER_COST_COLUMNS,
  ORDER_COST_JOIN,
  toOrderProductCost,
  type OrderCostRow,
} from '../products/effective-cost';
import type {
  OrderSettlementSummaryDto,
  OrderSort,
  OrderSortKey,
  OrderStatusCountDto,
  OrderSummaryDto,
  StatusEventDto,
} from './dto/order.dto';

export interface OrderSummaryRow extends OrderCostRow {
  id: number | string;
  subOrderNo: string;
  orderNo: string | null;
  orderDate: string;
  productName: string | null;
  sku: string | null;
  size: string | null;
  quantity: number | string;
  customerState: string | null;
  supplierListedPrice: string | null;
  supplierDiscountedPrice: string | null;
  currentStatus: string;
  currentStatusObservedAt: Date | string;
}

/**
 * Order summary columns. Since M6 they include the product cost (ORDER_COST_COLUMNS), so every query
 * selecting them must also add ORDER_SUMMARY_JOINS after `FROM orders o`.
 */
export const ORDER_SUMMARY_COLUMNS = `o.id, o.sub_order_no AS subOrderNo, o.order_no AS orderNo,
              o.order_date AS orderDate, o.product_name AS productName, o.sku, o.size, o.quantity,
              o.customer_state AS customerState, o.supplier_listed_price AS supplierListedPrice,
              o.supplier_discounted_price AS supplierDiscountedPrice, o.current_status AS currentStatus,
              o.current_status_observed_at AS currentStatusObservedAt,
              ${ORDER_COST_COLUMNS}`;

/** The joins ORDER_SUMMARY_COLUMNS needs: the cost row effective on the order date (effective-cost.ts). */
export const ORDER_SUMMARY_JOINS = ORDER_COST_JOIN;

const SORT_COLUMNS: Readonly<Record<OrderSortKey, string>> = {
  orderDate: 'o.order_date',
  subOrderNo: 'o.sub_order_no',
  currentStatus: 'o.current_status',
  updatedAt: 'o.updated_at',
};

/** ORDER BY for a validated sort value; ties break on id in the same direction (stable pages). */
export function orderOrderBy(sort: OrderSort): string {
  const { key, descending } = parseSort<OrderSortKey>(sort);
  const dir = descending ? 'DESC' : 'ASC';
  return `${SORT_COLUMNS[key]} ${dir}, o.id ${dir}`;
}

/** Orders of exactly this account (both ids come from requireAccount). */
export function orderScope(scope: AccountScope): SqlFilter {
  return {
    conditions: [
      'o.seller_account_id = :sellerAccountId',
      'o.workspace_id = :workspaceId',
    ],
    replacements: {
      sellerAccountId: scope.sellerAccountId,
      workspaceId: scope.workspaceId,
    },
  };
}

/**
 * "The order has a settlement": at least one entry matched to it that is not superseded. Orders without
 * one are the reconciliation exception "orders without settlement".
 */
export const HAS_SETTLEMENT_SQL = `EXISTS (SELECT 1 FROM settlement_entries s
                WHERE s.seller_account_id = o.seller_account_id AND s.order_id = o.id
                  AND s.superseded_by_entry_id IS NULL)`;

/** Raw statuses compared exactly (binary), the way GET .../orders/statuses groups them. */
export function addStatusFilter(
  filter: SqlFilter,
  statuses: readonly string[] | undefined,
): void {
  if (!statuses || statuses.length === 0) return;
  filter.conditions.push('o.current_status COLLATE utf8mb4_bin IN (:statuses)');
  filter.replacements.statuses = [...new Set(statuses)];
}

export function toOrderSummaryDto(
  row: OrderSummaryRow,
  settlement: OrderSettlementSummaryDto,
): OrderSummaryDto {
  return {
    id: String(row.id),
    subOrderNo: row.subOrderNo,
    orderNo: row.orderNo,
    orderDate: row.orderDate,
    productName: row.productName,
    sku: row.sku,
    size: row.size,
    quantity: Number(row.quantity),
    customerState: row.customerState,
    supplierListedPrice: moneyOrNull(row.supplierListedPrice),
    supplierDiscountedPrice: moneyOrNull(row.supplierDiscountedPrice),
    currentStatus: row.currentStatus,
    currentStatusObservedAt: isoTimestamp(row.currentStatusObservedAt),
    settlement,
    productId: idOrNull(row.productId),
    productCost: toOrderProductCost(row),
  };
}

const NO_SETTLEMENT: OrderSettlementSummaryDto = {
  entryCount: 0,
  amount: null,
};

/**
 * Per order: matched, non-superseded entries and SUM(settlement_amount) as reported (DECIMAL, as text).
 * Orders without any get { entryCount: 0, amount: null }.
 */
export async function settlementSummaries(
  sequelize: Sequelize,
  scope: AccountScope,
  orderIds: readonly (number | string)[],
  transaction?: Transaction,
): Promise<Map<string, OrderSettlementSummaryDto>> {
  const result = new Map<string, OrderSettlementSummaryDto>();
  if (orderIds.length === 0) return result;
  const rows = await sequelize.query<{
    orderId: number | string;
    entryCount: unknown;
    amount: unknown;
  }>(
    `SELECT se.order_id AS orderId, COUNT(*) AS entryCount,
            CAST(SUM(se.settlement_amount) AS CHAR) AS amount
       FROM settlement_entries se
       WHERE se.seller_account_id = :sellerAccountId AND se.workspace_id = :workspaceId
         AND se.order_id IN (:orderIds) AND se.superseded_by_entry_id IS NULL
       GROUP BY se.order_id`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        sellerAccountId: scope.sellerAccountId,
        workspaceId: scope.workspaceId,
        orderIds: orderIds.map(String),
      },
      transaction,
    },
  );
  for (const row of rows) {
    result.set(String(row.orderId), {
      entryCount: toCount(row.entryCount),
      amount: moneyOrNull(row.amount),
    });
  }
  return result;
}

/**
 * A page of order summaries (with their settlement summaries) and the total row count of the filter.
 * Deferred join (M6): the page's ids are found first (filter, order, LIMIT/OFFSET on `orders` alone), and
 * only those rows are joined to their cost, so a deep page does not look up a cost for every skipped row.
 * `orderBy` only uses `o.` columns, so it sorts the inner ids and the outer rows the same way.
 */
export async function pageOfOrders(
  sequelize: Sequelize,
  scope: AccountScope,
  filter: SqlFilter,
  orderBy: string,
  window: { limit: number; offset: number },
  transaction?: Transaction,
): Promise<{ items: OrderSummaryDto[]; total: number }> {
  const rows = await sequelize.query<OrderSummaryRow>(
    `SELECT ${ORDER_SUMMARY_COLUMNS}
       FROM (SELECT o.id FROM orders o
             ${whereClause(filter)}
             ORDER BY ${orderBy}
             LIMIT :limit OFFSET :offset) pg
       JOIN orders o ON o.id = pg.id
       ${ORDER_SUMMARY_JOINS}
       ORDER BY ${orderBy}`,
    {
      type: QueryTypes.SELECT,
      replacements: { ...filter.replacements, ...window },
      transaction,
    },
  );
  const [count] = await sequelize.query<{ total: unknown }>(
    `SELECT COUNT(*) AS total FROM orders o
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  const summaries = await settlementSummaries(
    sequelize,
    scope,
    rows.map((r) => r.id),
    transaction,
  );
  return {
    items: rows.map((row) =>
      toOrderSummaryDto(row, summaries.get(String(row.id)) ?? NO_SETTLEMENT),
    ),
    total: toCount(count?.total),
  };
}

/** Raw current statuses with their order counts (exact, binary grouping), most orders first. */
export async function statusCounts(
  sequelize: Sequelize,
  filter: SqlFilter,
  transaction?: Transaction,
): Promise<OrderStatusCountDto[]> {
  const rows = await sequelize.query<{ status: string; count: unknown }>(
    `SELECT o.current_status COLLATE utf8mb4_bin AS status, COUNT(*) AS count
       FROM orders o
       ${whereClause(filter)}
       GROUP BY o.current_status COLLATE utf8mb4_bin
       ORDER BY count DESC, status ASC`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  return rows.map((r) => ({ status: r.status, count: toCount(r.count) }));
}

export interface StatusEventRow {
  id: number | string;
  status: string;
  observedAt: Date | string;
  importJobId: number | string;
  importOriginalFilename: string;
  importCreatedAt: Date | string;
}

export function toStatusEventDto(row: StatusEventRow): StatusEventDto {
  return {
    id: String(row.id),
    status: row.status,
    observedAt: isoTimestamp(row.observedAt),
    importJob: toImportRef(
      row.importJobId,
      row.importOriginalFilename,
      row.importCreatedAt,
    ),
  };
}

/** Status observations of one order of the account, oldest first (observedAt, then id). */
export async function statusEventsOf(
  sequelize: Sequelize,
  scope: AccountScope,
  orderId: number | string,
  transaction?: Transaction,
): Promise<StatusEventDto[]> {
  const rows = await sequelize.query<StatusEventRow>(
    `SELECT e.id, e.status, e.observed_at AS observedAt, j.id AS importJobId,
            j.original_filename AS importOriginalFilename, j.created_at AS importCreatedAt
       FROM order_status_events e
       JOIN import_jobs j ON j.seller_account_id = e.seller_account_id AND j.id = e.import_job_id
       WHERE e.seller_account_id = :sellerAccountId AND e.workspace_id = :workspaceId
         AND e.order_id = :orderId
       ORDER BY e.observed_at ASC, e.id ASC`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        sellerAccountId: scope.sellerAccountId,
        workspaceId: scope.workspaceId,
        orderId: String(orderId),
      },
      transaction,
    },
  );
  return rows.map(toStatusEventDto);
}
