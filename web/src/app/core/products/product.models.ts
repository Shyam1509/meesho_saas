import { PageQuery } from '../api/paged-response';
import { UserRef } from '../api/refs';

/** `archived` products are hidden from the default list; their orders and costs are kept. */
export type ProductStatus = 'active' | 'archived';

/** The unit cost effective today (Asia/Kolkata): the cost row with the latest `effectiveFrom` ≤ today. */
export interface ProductCurrentCost {
  /** Decimal string, up to 4 decimals. */
  unitCost: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
}

/**
 * One row of `GET /accounts/:accountId/products`: one product per SKU of a seller account.
 * `currentCost` is `null` when no cost applies today (unknown, never 0). `ordersWithoutCost` counts
 * the product's orders whose order date has no effective cost.
 */
export interface ProductSummary {
  id: string;
  sellerAccountId: string;
  sku: string;
  name: string | null;
  catalogId: string | null;
  status: ProductStatus;
  orderCount: number;
  ordersWithoutCost: number;
  currentCost: ProductCurrentCost | null;
  costCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One effective-dated unit cost. Never edited in place: delete it and add a new one. */
export interface CostEntry {
  id: string;
  /** Decimal string, up to 4 decimals (`"0"` is a real zero cost). */
  unitCost: string;
  /** `YYYY-MM-DD`: the cost applies from this order date until the next entry's date. */
  effectiveFrom: string;
  note: string | null;
  createdBy: UserRef;
  createdAt: string;
}

/**
 * `GET /products/:productId`. `costHistory` is newest `effectiveFrom` first; `workspaceId` is the
 * workspace of the product's seller account (for the caller's role there).
 */
export interface ProductDetail extends ProductSummary {
  workspaceId: string;
  costHistory: CostEntry[];
}

/** `-` prefix = descending. The API's default is `sku`. */
export type ProductSort =
  | 'sku'
  | '-sku'
  | 'name'
  | '-name'
  | 'orderCount'
  | '-orderCount'
  | 'currentUnitCost'
  | '-currentUnitCost';

export const PRODUCT_SORTS: readonly ProductSort[] = [
  'sku',
  '-sku',
  'name',
  '-name',
  'orderCount',
  '-orderCount',
  'currentUnitCost',
  '-currentUnitCost',
];

export const DEFAULT_PRODUCT_SORT: ProductSort = 'sku';

/** `all` lists both statuses. The API's default is `active`. */
export type ProductStatusFilter = ProductStatus | 'all';

export const PRODUCT_STATUS_FILTERS: readonly ProductStatusFilter[] = ['active', 'archived', 'all'];

export const DEFAULT_PRODUCT_STATUS_FILTER: ProductStatusFilter = 'active';

/**
 * `missing`: no cost effective today. `known`: a cost is effective today. `incomplete`: some of the
 * product's orders have no cost on their order date (`ordersWithoutCost > 0`).
 */
export type ProductCostFilter = 'missing' | 'known' | 'incomplete';

export const PRODUCT_COST_FILTERS: readonly ProductCostFilter[] = ['missing', 'known', 'incomplete'];

/** Query of `GET /accounts/:accountId/products`. Only the given values are sent. */
export interface ProductListQuery extends PageQuery {
  sort?: ProductSort;
  /** Part of the SKU or name. */
  q?: string;
  status?: ProductStatusFilter;
  cost?: ProductCostFilter;
}

/** Body of `POST /accounts/:accountId/products` (member+). */
export interface CreateProductRequest {
  sku: string;
  name?: string;
  catalogId?: string;
}

/** Body of `PATCH /products/:productId` (member+). `name: null` clears the name. */
export interface UpdateProductRequest {
  name?: string | null;
  status?: ProductStatus;
}

/** Body of `POST /products/:productId/cost-history` (owner). */
export interface CreateCostEntryRequest {
  /** `YYYY-MM-DD`, at most {@link COST_MAX_DAYS_AHEAD} days after today. */
  effectiveFrom: string;
  /** Decimal string: 0 ≤ x < 100000000, at most 4 decimals. */
  unitCost: string;
  note?: string;
}

/** `POST /accounts/:accountId/products/sync`. */
export interface ProductSyncResult {
  createdProducts: number;
  linkedOrders: number;
}

/** Field rules shared with the API. */
export const PRODUCT_SKU_MAX_LENGTH = 128;
export const PRODUCT_NAME_MAX_LENGTH = 512;
export const PRODUCT_CATALOG_ID_MAX_LENGTH = 64;
export const COST_NOTE_MAX_LENGTH = 255;
/** A unit cost: digits with up to 4 decimals, no sign, no leading zeros (as the API). */
export const UNIT_COST_PATTERN = /^(0|[1-9]\d*)(\.\d{1,4})?$/;
/** Unit costs must be below this. */
export const UNIT_COST_LIMIT = 100_000_000;
/** How far ahead a planned price change may start. */
export const COST_MAX_DAYS_AHEAD = 366;

/** The list's page size. */
export const PRODUCT_PAGE_SIZE = 25;

/** The time zone the API uses for "today" (current cost, future dates). */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

/** How an order's product cost is worked out, for help text next to it. */
export const PRODUCT_COST_RULE =
  'Product cost = the unit cost effective on the order date × quantity. Orders dated before a product’s first cost have an unknown cost, never ₹0.';

/** "Archived" / "Active". */
export function productStatusLabel(status: string): string {
  return status === 'archived' ? 'Archived' : status === 'active' ? 'Active' : status;
}
