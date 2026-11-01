import { moneyOrNull } from '../common/sql/values';

/**
 * The effective-dated cost rule (db/SCHEMA.md), in ONE place for every query that shows a cost:
 * the unit cost of a product on date D is the product_cost_history row with the greatest
 * `effective_from <= D`. No such row → the cost is UNKNOWN (null), never 0. `effective_from` is unique per
 * product, so at most one row qualifies. Both lookups below use the unique key
 * (product_id, effective_from).
 *
 * The SQL expressions passed in are column references chosen by our own code (never user input).
 */

/**
 * LEFT JOIN `product_cost_history <alias>` on the row effective on `dateExpr` for product `productIdExpr`.
 * The joined columns are NULL when the cost is unknown on that date (or the product id is NULL).
 */
export function effectiveCostJoin(
  alias: string,
  productIdExpr: string,
  dateExpr: string,
): string {
  return `LEFT JOIN product_cost_history ${alias}
         ON ${alias}.product_id = ${productIdExpr}
        AND ${alias}.effective_from = (SELECT MAX(${alias}_m.effective_from) FROM product_cost_history ${alias}_m
                                        WHERE ${alias}_m.product_id = ${productIdExpr}
                                          AND ${alias}_m.effective_from <= ${dateExpr})`;
}

/** Which per-product statistics a product query needs (only those are computed). */
export interface ProductStatsNeeds {
  /** `pcs` (cost history: current / first effective date, count). */
  costs: boolean;
  /** `poc`: none; `count` = orderCount only; `full` = also ordersWithoutCost (needs `pcs`). */
  orders: 'none' | 'count' | 'full';
}

/**
 * The same rule for many products of one account at once, as CTEs (one grouped pass over their cost rows,
 * one over their orders) instead of dependent subqueries per product (EXPLAIN on 5k products / 20k orders:
 * sorting by order count went from ~1 s to tens of ms; see README):
 * - `pcs` per product: `currentFrom` = MAX(effective_from) <= `:today` (the cost effective on that day, by
 *   definition), `firstFrom` = MIN(effective_from), `costCount`. Driven from the account's products
 *   (STRAIGHT_JOIN, grouped in product-id order), so it never scans other tenants' cost rows
 *   (product_cost_history has no account column);
 * - `poc` per product: `orderCount`, and (`full`) `ordersWithoutCost` = orders with no cost row on or before
 *   their order date, i.e. `order_date < firstFrom` (or no cost at all): the same set as
 *   effectiveCostJoin's unknown state, since a row <= D exists exactly when the first one is <= D.
 * Binds :sellerAccountId and :today; with `restrictToIds`, also :ids (every pass limited to those products).
 * Returns '' when nothing is needed. Join `pcs` / `poc` on product id, and the current cost row as
 * `product_cost_history` on (product_id, effective_from = pcs.currentFrom).
 */
export function productStatsCtes(
  needs: ProductStatsNeeds,
  restrictToIds: boolean,
): string {
  const ids = (column: string) =>
    restrictToIds ? ` AND ${column} IN (:ids)` : '';
  const ctes: string[] = [];
  if (needs.costs || needs.orders === 'full') {
    ctes.push(`pcs AS (
         SELECT hp.id AS product_id, MIN(h.effective_from) AS firstFrom, COUNT(*) AS costCount,
                MAX(CASE WHEN h.effective_from <= :today THEN h.effective_from END) AS currentFrom
         FROM products hp
         STRAIGHT_JOIN product_cost_history h ON h.product_id = hp.id
         WHERE hp.seller_account_id = :sellerAccountId${ids('hp.id')}
         GROUP BY hp.id
       )`);
  }
  if (needs.orders === 'count') {
    ctes.push(`poc AS (
         SELECT o.product_id, COUNT(*) AS orderCount
         FROM orders o
         WHERE o.seller_account_id = :sellerAccountId AND o.product_id IS NOT NULL${ids('o.product_id')}
         GROUP BY o.product_id
       )`);
  } else if (needs.orders === 'full') {
    ctes.push(`poc AS (
         SELECT o.product_id, COUNT(*) AS orderCount,
                COUNT(CASE WHEN pcs.firstFrom IS NULL OR o.order_date < pcs.firstFrom THEN 1 END) AS ordersWithoutCost
         FROM orders o
         LEFT JOIN pcs ON pcs.product_id = o.product_id
         WHERE o.seller_account_id = :sellerAccountId AND o.product_id IS NOT NULL${ids('o.product_id')}
         GROUP BY o.product_id
       )`);
  }
  return ctes.length > 0 ? `WITH ${ctes.join(', ')}` : '';
}

/** The order's cost row: effective on the ORDER date, for the order's mapped product. */
export const ORDER_COST_JOIN = effectiveCostJoin(
  'pc',
  'o.product_id',
  'o.order_date',
);

/**
 * Order cost columns (needs ORDER_COST_JOIN). The line total is `unit_cost × quantity` computed by MySQL in
 * DECIMAL: DECIMAL(12,4) × an integer keeps 4 decimals exactly (no rounding), returned as text.
 */
export const ORDER_COST_COLUMNS = `o.product_id AS productId, pc.unit_cost AS costUnitCost,
              pc.effective_from AS costEffectiveFrom, CAST(pc.unit_cost * o.quantity AS CHAR) AS costTotal`;

export const PRODUCT_COST_STATES = ['known', 'unknown', 'no_product'] as const;
export type ProductCostState = (typeof PRODUCT_COST_STATES)[number];

/** The raw ORDER_COST_COLUMNS of one order row. */
export interface OrderCostRow {
  productId: number | string | null;
  costUnitCost: string | null;
  costEffectiveFrom: string | null;
  costTotal: string | null;
}

export interface OrderProductCost {
  state: ProductCostState;
  unitCost: string | null;
  effectiveFrom: string | null;
  total: string | null;
}

/**
 * `no_product`: the order is mapped to no product (it has no SKU, or its SKU has no product yet: run
 * products sync for data imported before M6); `unknown`: mapped, but no cost is effective on the order
 * date (profit incomplete); `known`: unit cost, its effective date and the exact line total.
 */
export function toOrderProductCost(row: OrderCostRow): OrderProductCost {
  if (row.productId === null || row.productId === undefined) {
    return {
      state: 'no_product',
      unitCost: null,
      effectiveFrom: null,
      total: null,
    };
  }
  const unitCost = moneyOrNull(row.costUnitCost);
  if (unitCost === null) {
    return {
      state: 'unknown',
      unitCost: null,
      effectiveFrom: null,
      total: null,
    };
  }
  return {
    state: 'known',
    unitCost,
    effectiveFrom: row.costEffectiveFrom,
    total: moneyOrNull(row.costTotal),
  };
}
