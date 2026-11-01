import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { parseSort } from '../common/http/list-query';
import { isoTimestamp } from '../common/http/refs.dto';
import {
  whereClause,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { LIKE_ESCAPE, likeContains, likePrefix } from '../common/sql/like';
import { moneyOrNull, toCount } from '../common/sql/values';
import type { ProductStatus } from '../database/models';
import type {
  CostEntryDto,
  ListProductsQueryDto,
  ProductSort,
  ProductSortKey,
  ProductSummaryDto,
} from './dto/product.dto';
import { productStatsCtes, type ProductStatsNeeds } from './effective-cost';

export interface ProductSummaryRow {
  id: number | string;
  workspaceId: number | string;
  sellerAccountId: number | string;
  sku: string;
  name: string | null;
  catalogId: string | null;
  status: ProductStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  orderCount: unknown;
  ordersWithoutCost: unknown;
  currentUnitCost: string | null;
  currentEffectiveFrom: string | null;
  costCount: unknown;
}

const SUMMARY_COLUMNS = `p.id, p.workspace_id AS workspaceId,
              p.seller_account_id AS sellerAccountId, p.sku, p.name,
              p.catalog_id AS catalogId, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
              COALESCE(poc.orderCount, 0) AS orderCount,
              COALESCE(poc.ordersWithoutCost, 0) AS ordersWithoutCost,
              cc.unit_cost AS currentUnitCost, cc.effective_from AS currentEffectiveFrom,
              COALESCE(pcs.costCount, 0) AS costCount`;

const NO_STATS: ProductStatsNeeds = { costs: false, orders: 'none' };
const ALL_STATS: ProductStatsNeeds = { costs: true, orders: 'full' };

/** The union of two needs (orders: none < count < full). */
function mergeNeeds(
  a: ProductStatsNeeds,
  b: ProductStatsNeeds,
): ProductStatsNeeds {
  const rank = { none: 0, count: 1, full: 2 } as const;
  return {
    costs: a.costs || b.costs,
    orders: rank[a.orders] >= rank[b.orders] ? a.orders : b.orders,
  };
}

/**
 * `FROM products p` with only the per-product statistics `needs` asks for (productStatsCtes: the
 * effective-cost rule for `:today`, India date bound by the caller): `pcs` + `cc` = the cost row effective
 * today, `poc` = order counts. `restrictToIds` limits the statistics passes to the products in `:ids`.
 * `ordersWithoutCost` always equals the number of the product's orders whose productCost.state is 'unknown'.
 */
function productQuery(
  columns: string,
  needs: ProductStatsNeeds,
  restrictToIds = false,
): string {
  const joins: string[] = [];
  if (needs.costs) {
    joins.push(
      'LEFT JOIN pcs ON pcs.product_id = p.id',
      'LEFT JOIN product_cost_history cc ON cc.product_id = p.id AND cc.effective_from = pcs.currentFrom',
    );
  }
  if (needs.orders !== 'none')
    joins.push('LEFT JOIN poc ON poc.product_id = p.id');
  return `${productStatsCtes(needs, restrictToIds)}
       SELECT ${columns}
       FROM products p${joins.map((j) => `\n       ${j}`).join('')}`;
}

/** SELECT of product summaries for the products in `:ids` (statistics computed for those only). */
export function productSummarySelect(): string {
  return productQuery(SUMMARY_COLUMNS, ALL_STATS, true);
}

/** ORDER BY per sort key; `nullsLast` keys put rows without a value last; `needs` = statistics it reads. */
const SORTS: Readonly<
  Record<
    ProductSortKey,
    { column: string; nullsLast: boolean; needs: ProductStatsNeeds }
  >
> = {
  sku: { column: 'p.sku', nullsLast: false, needs: NO_STATS },
  name: { column: 'p.name', nullsLast: true, needs: NO_STATS },
  orderCount: {
    column: 'COALESCE(poc.orderCount, 0)',
    nullsLast: false,
    needs: { costs: false, orders: 'count' },
  },
  currentUnitCost: {
    column: 'cc.unit_cost',
    nullsLast: true,
    needs: { costs: true, orders: 'none' },
  },
};

/** ORDER BY for a validated sort value; ties break on id in the same direction (stable pages). */
export function productOrderBy(sort: ProductSort): string {
  const { key, descending } = parseSort<ProductSortKey>(sort);
  const dir = descending ? 'DESC' : 'ASC';
  const { column, nullsLast } = SORTS[key];
  return `${nullsLast ? `${column} IS NULL, ` : ''}${column} ${dir}, p.id ${dir}`;
}

/** The statistics a sort reads (sku / name read none: ids-first paging then skips them). */
export function sortNeeds(sort: ProductSort): ProductStatsNeeds {
  return SORTS[parseSort<ProductSortKey>(sort).key].needs;
}

/** A product list filter; `needs` = the statistics its conditions read (`cc`, `poc`). */
export interface ProductFilter extends SqlFilter {
  needs: ProductStatsNeeds;
}

/** Products of exactly this account (ids from requireAccount); `today` = India date for currentCost. */
export function productScope(
  scope: AccountScope,
  today: string,
): ProductFilter {
  return {
    conditions: [
      'p.seller_account_id = :sellerAccountId',
      'p.workspace_id = :workspaceId',
    ],
    replacements: {
      sellerAccountId: scope.sellerAccountId,
      workspaceId: scope.workspaceId,
      today,
    },
    needs: NO_STATS,
  };
}

/** `cost=incomplete`: the product has an order without a cost on its order date (ordersWithoutCost > 0). */
export const INCOMPLETE_SQL = 'poc.ordersWithoutCost > 0';

const COST_FILTERS: Readonly<
  Record<
    NonNullable<ListProductsQueryDto['cost']>,
    { sql: string; needs: ProductStatsNeeds }
  >
> = {
  missing: { sql: 'cc.id IS NULL', needs: { costs: true, orders: 'none' } },
  known: { sql: 'cc.id IS NOT NULL', needs: { costs: true, orders: 'none' } },
  incomplete: { sql: INCOMPLETE_SQL, needs: { costs: false, orders: 'full' } },
};

/** The ListProductsQueryDto filters as SQL conditions on `products p` (+ `cc`, `poc`); values are bound. */
export function productListFilter(
  scope: AccountScope,
  today: string,
  query: Pick<ListProductsQueryDto, 'status' | 'q' | 'cost'>,
): ProductFilter {
  const filter = productScope(scope, today);
  if (query.status && query.status !== 'all') {
    filter.conditions.push('p.status = :status');
    filter.replacements.status = query.status;
  }
  if (query.q) {
    filter.conditions.push(
      `(p.sku LIKE :qPrefix ${LIKE_ESCAPE} OR p.name LIKE :qContains ${LIKE_ESCAPE})`,
    );
    filter.replacements.qPrefix = likePrefix(query.q);
    filter.replacements.qContains = likeContains(query.q);
  }
  if (query.cost) {
    filter.conditions.push(COST_FILTERS[query.cost].sql);
    filter.needs = COST_FILTERS[query.cost].needs;
  }
  return filter;
}

export function toProductSummaryDto(row: ProductSummaryRow): ProductSummaryDto {
  const unitCost = moneyOrNull(row.currentUnitCost);
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    sellerAccountId: String(row.sellerAccountId),
    sku: row.sku,
    name: row.name,
    catalogId: row.catalogId,
    status: row.status,
    orderCount: toCount(row.orderCount),
    ordersWithoutCost: toCount(row.ordersWithoutCost),
    currentCost:
      unitCost === null || row.currentEffectiveFrom === null
        ? null
        : { unitCost, effectiveFrom: row.currentEffectiveFrom },
    costCount: toCount(row.costCount),
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

/**
 * Summaries of these products of the account, in the order of `ids` (an id of another account is skipped).
 * The statistics passes are restricted to these ids, so a page costs the same however large the account.
 */
export async function productSummaries(
  sequelize: Sequelize,
  scope: AccountScope,
  ids: readonly (number | string)[],
  today: string,
  transaction?: Transaction,
): Promise<ProductSummaryDto[]> {
  if (ids.length === 0) return [];
  const filter = productScope(scope, today);
  filter.conditions.push('p.id IN (:ids)');
  filter.replacements.ids = ids.map(String);
  const rows = await sequelize.query<ProductSummaryRow>(
    `${productSummarySelect()}
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids
    .map((id) => byId.get(String(id)))
    .filter((row): row is ProductSummaryRow => row !== undefined)
    .map(toProductSummaryDto);
}

/**
 * A page of product summaries and the filter's total, ids first (deferred join): the page's ids are found
 * on `products`, with the statistics joins (one grouped pass over the account's cost rows and orders) only
 * when the sort or a filter needs them; then the summaries of just those ids are read. Call inside one
 * snapshot transaction so the three reads agree.
 */
export async function pageOfProducts(
  sequelize: Sequelize,
  scope: AccountScope,
  filter: ProductFilter,
  sort: ProductSort,
  window: { limit: number; offset: number },
  transaction?: Transaction,
): Promise<{ items: ProductSummaryDto[]; total: number }> {
  const idRows = await sequelize.query<{ id: number | string }>(
    `${productQuery('p.id', mergeNeeds(filter.needs, sortNeeds(sort)))}
       ${whereClause(filter)}
       ORDER BY ${productOrderBy(sort)}
       LIMIT :limit OFFSET :offset`,
    {
      type: QueryTypes.SELECT,
      replacements: { ...filter.replacements, ...window },
      transaction,
    },
  );
  const [count] = await sequelize.query<{ total: unknown }>(
    `${productQuery('COUNT(*) AS total', filter.needs)}
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  return {
    items: await productSummaries(
      sequelize,
      scope,
      idRows.map((r) => r.id),
      String(filter.replacements.today),
      transaction,
    ),
    total: toCount(count?.total),
  };
}

/** One product of the account as a summary, or null when it is not in this account. */
export async function findProductSummary(
  sequelize: Sequelize,
  scope: AccountScope,
  productId: number | string,
  today: string,
  transaction?: Transaction,
): Promise<ProductSummaryDto | null> {
  const [product] = await productSummaries(
    sequelize,
    scope,
    [productId],
    today,
    transaction,
  );
  return product ?? null;
}

export interface CostEntryRow {
  id: number | string;
  unitCost: string;
  effectiveFrom: string;
  note: string | null;
  createdAt: Date | string;
  createdById: number | string;
  createdByDisplayName: string | null;
  createdByEmail: string;
}

const COST_SELECT = `SELECT c.id, c.unit_cost AS unitCost, c.effective_from AS effectiveFrom, c.note,
              c.created_at AS createdAt, u.id AS createdById, u.display_name AS createdByDisplayName,
              u.email AS createdByEmail
       FROM product_cost_history c
       JOIN users u ON u.id = c.created_by_user_id`;

export function toCostEntryDto(row: CostEntryRow): CostEntryDto {
  const unitCost = moneyOrNull(row.unitCost);
  if (unitCost === null) throw new Error('unit_cost is NOT NULL');
  return {
    id: String(row.id),
    unitCost,
    effectiveFrom: row.effectiveFrom,
    note: row.note,
    createdBy: {
      id: String(row.createdById),
      displayName: row.createdByDisplayName,
      email: row.createdByEmail,
    },
    createdAt: isoTimestamp(row.createdAt),
  };
}

/** Cost history of a product (its id already resolved for the caller), newest effectiveFrom first. */
export async function costHistoryOf(
  sequelize: Sequelize,
  productId: number | string,
  transaction?: Transaction,
): Promise<CostEntryDto[]> {
  const rows = await sequelize.query<CostEntryRow>(
    `${COST_SELECT}
       WHERE c.product_id = :productId
       ORDER BY c.effective_from DESC, c.id DESC`,
    {
      type: QueryTypes.SELECT,
      replacements: { productId: String(productId) },
      transaction,
    },
  );
  return rows.map(toCostEntryDto);
}

/** One cost row by id, or null. */
export async function findCostEntry(
  sequelize: Sequelize,
  costId: number | string,
  transaction?: Transaction,
): Promise<CostEntryDto | null> {
  const [row] = await sequelize.query<CostEntryRow>(
    `${COST_SELECT}
       WHERE c.id = :costId`,
    {
      type: QueryTypes.SELECT,
      replacements: { costId: String(costId) },
      transaction,
    },
  );
  return row ? toCostEntryDto(row) : null;
}
