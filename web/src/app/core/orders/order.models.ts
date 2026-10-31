import { PageQuery } from '../api/paged-response';
import { ImportRef } from '../api/refs';
import { SettlementEntry } from '../settlements/settlement.models';

/**
 * What has been settled for an order so far: the matched, non-superseded settlement entries.
 * `amount` is the SUM of their settlement amounts as reported by Meesho (`null` when there are none
 * or none reported an amount); it is not profit and not a bank payout.
 */
export interface OrderSettlementSummary {
  entryCount: number;
  amount: string | null;
}

/**
 * One row of `GET /accounts/:accountId/orders`. Amounts are decimal strings (`null` = not in the
 * report), dates `YYYY-MM-DD`, timestamps ISO-8601. `currentStatus` is Meesho's raw status text.
 */
export interface OrderSummary {
  id: string;
  subOrderNo: string;
  orderNo: string | null;
  orderDate: string | null;
  productName: string | null;
  sku: string | null;
  size: string | null;
  quantity: number | null;
  customerState: string | null;
  supplierListedPrice: string | null;
  supplierDiscountedPrice: string | null;
  currentStatus: string | null;
  currentStatusObservedAt: string | null;
  settlement: OrderSettlementSummary;
}

/** One saved status of an order, from the import that reported it. */
export interface StatusEvent {
  id: string;
  status: string;
  /** ISO-8601: when the report's statuses were current. */
  observedAt: string;
  importJob: ImportRef;
}

/** `GET /accounts/:accountId/orders/:orderId`. */
export interface OrderDetail extends OrderSummary {
  catalogId: string | null;
  packetId: string | null;
  createdAt: string;
  updatedAt: string;
  firstImport: ImportRef;
  lastImport: ImportRef;
  /** Oldest first (`observedAt`, then `id`). */
  statusHistory: StatusEvent[];
  /** The matched settlement entries. */
  settlements: SettlementEntry[];
}

/** One status and how many of the account's orders currently have it (`GET …/orders/statuses`). */
export interface OrderStatusCount {
  status: string;
  count: number;
}

/** `-` prefix = descending. The API's default is `-orderDate`. */
export type OrderSort =
  | 'orderDate'
  | '-orderDate'
  | 'subOrderNo'
  | '-subOrderNo'
  | 'currentStatus'
  | '-currentStatus'
  | 'updatedAt'
  | '-updatedAt';

export const ORDER_SORTS: readonly OrderSort[] = [
  'orderDate',
  '-orderDate',
  'subOrderNo',
  '-subOrderNo',
  'currentStatus',
  '-currentStatus',
  'updatedAt',
  '-updatedAt',
];

export const DEFAULT_ORDER_SORT: OrderSort = '-orderDate';

/** Orders with at least one matched settlement entry, or with none. */
export type OrderSettlementFilter = 'matched' | 'unmatched';

export const ORDER_SETTLEMENT_FILTERS: readonly OrderSettlementFilter[] = ['matched', 'unmatched'];

/** Query of `GET /accounts/:accountId/orders`. Only the given values are sent. */
export interface OrderListQuery extends PageQuery {
  sort?: OrderSort;
  /** Raw statuses; sent as a repeated `status` parameter. */
  status?: readonly string[];
  /** Order date from, `YYYY-MM-DD` (inclusive). */
  from?: string;
  /** Order date to, `YYYY-MM-DD` (inclusive). */
  to?: string;
  /** Prefix of the sub order no. or SKU, or part of the product name. */
  q?: string;
  settlement?: OrderSettlementFilter;
}

/** Query of `GET /accounts/:accountId/reconciliation/orders-without-settlement`. */
export interface OrdersWithoutSettlementQuery extends PageQuery {
  sort?: OrderSort;
  status?: readonly string[];
}

/** The API's default page size for these lists. */
export const ORDER_PAGE_SIZE = 25;
