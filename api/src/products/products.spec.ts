import { ValidationPipe, type Type } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../app.setup';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import { scopeOf } from '../common/sql/account-scope';
import { addDays, todayInIndia } from '../common/time/india-date';
import {
  AddCostDto,
  CreateProductDto,
  ListProductsQueryDto,
  PRODUCT_SORTS,
  UpdateProductDto,
} from './dto/product.dto';
import {
  effectiveCostJoin,
  ORDER_COST_COLUMNS,
  productStatsCtes,
  toOrderProductCost,
} from './effective-cost';
import {
  createMissingProductsSql,
  JOB_SKUS_SQL,
  LINK_SKU_SQL,
  RELINK_SKUS_SQL,
  relinkOrdersSql,
} from './product-mapping.service';
import {
  INCOMPLETE_SQL,
  productListFilter,
  productOrderBy,
  productSummarySelect,
  sortNeeds,
  toProductSummaryDto,
} from './product-queries';

/** The real global pipe (whitelist + forbidNonWhitelisted + transform), as the app runs it. */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

async function accept<T>(
  metatype: Type<T>,
  value: object,
  type: 'query' | 'body' = 'body',
): Promise<T> {
  return (await pipe.transform(value, { type, metatype })) as T;
}

/** Field → reasons of a rejected value (fails the test if it is accepted). */
async function reject(
  metatype: Type<unknown>,
  value: object,
  type: 'query' | 'body' = 'body',
): Promise<Record<string, string[]>> {
  try {
    await pipe.transform(value, { type, metatype });
  } catch (err) {
    if (err instanceof RequestValidationException) {
      return Object.fromEntries(err.details.map((d) => [d.field, d.reasons]));
    }
    throw err;
  }
  throw new Error(`accepted ${JSON.stringify(value)}`);
}

describe('product cost of an order (mapping of the SQL columns)', () => {
  it('known: unit cost, its start date and the exact line total', () => {
    expect(
      toOrderProductCost({
        productId: 7,
        costUnitCost: '549.5000',
        costEffectiveFrom: '2026-10-02',
        costTotal: '1099.0000',
      }),
    ).toEqual({
      state: 'known',
      unitCost: '549.5000',
      effectiveFrom: '2026-10-02',
      total: '1099.0000',
    });
  });

  it('a zero cost is known (0.0000), never confused with unknown', () => {
    expect(
      toOrderProductCost({
        productId: '9',
        costUnitCost: '0.0000',
        costEffectiveFrom: '2026-10-01',
        costTotal: '0.0000',
      }).state,
    ).toBe('known');
  });

  it('unknown: mapped to a product but no cost on the order date → all null (never 0)', () => {
    expect(
      toOrderProductCost({
        productId: 7,
        costUnitCost: null,
        costEffectiveFrom: null,
        costTotal: null,
      }),
    ).toEqual({
      state: 'unknown',
      unitCost: null,
      effectiveFrom: null,
      total: null,
    });
  });

  it('no_product: no product id', () => {
    expect(
      toOrderProductCost({
        productId: null,
        costUnitCost: null,
        costEffectiveFrom: null,
        costTotal: null,
      }).state,
    ).toBe('no_product');
  });

  it('a DECIMAL that is not text is a wiring error, not a silent float', () => {
    expect(() =>
      toOrderProductCost({
        productId: 7,
        costUnitCost: 549.5 as unknown as string,
        costEffectiveFrom: '2026-10-02',
        costTotal: '1099.0000',
      }),
    ).toThrow('not returned as a string');
  });
});

describe('effective-cost SQL (the one rule: greatest effective_from <= date)', () => {
  it('joins the row whose effective_from is the MAX on or before the date, through the unique key', () => {
    const join = effectiveCostJoin('pc', 'o.product_id', 'o.order_date');
    expect(join).toContain('LEFT JOIN product_cost_history pc');
    expect(join).toContain('ON pc.product_id = o.product_id');
    expect(join).toMatch(
      /pc\.effective_from = \(SELECT MAX\(pc_m\.effective_from\) FROM product_cost_history pc_m\s+WHERE pc_m\.product_id = o\.product_id\s+AND pc_m\.effective_from <= o\.order_date\)/,
    );
  });

  it('account-wide form (product lists): current = MAX(effective_from) <= :today; without cost = order date before the first cost', () => {
    const ctes = productStatsCtes({ costs: true, orders: 'full' }, false);
    expect(ctes).toContain(
      'MAX(CASE WHEN h.effective_from <= :today THEN h.effective_from END) AS currentFrom',
    );
    expect(ctes).toContain('MIN(h.effective_from) AS firstFrom');
    expect(ctes).toContain(
      'COUNT(CASE WHEN pcs.firstFrom IS NULL OR o.order_date < pcs.firstFrom THEN 1 END) AS ordersWithoutCost',
    );
    // Driven from the account's products: never a scan of other tenants' cost rows.
    expect(ctes).toContain(
      'FROM products hp\n         STRAIGHT_JOIN product_cost_history h ON h.product_id = hp.id',
    );
    expect(ctes).toContain('WHERE hp.seller_account_id = :sellerAccountId\n');
    expect(ctes).not.toContain(':ids');
    const page = productStatsCtes({ costs: true, orders: 'full' }, true);
    expect(page).toContain('AND hp.id IN (:ids)');
    expect(page).toContain('AND o.product_id IN (:ids)');
    // Only what is asked for: order counts alone skip the cost pass; nothing → no CTE at all.
    const counts = productStatsCtes({ costs: false, orders: 'count' }, false);
    expect(counts).toMatch(/^WITH poc AS \(/);
    expect(counts).not.toContain('pcs');
    expect(counts).not.toContain('ordersWithoutCost');
    expect(productStatsCtes({ costs: false, orders: 'none' }, false)).toBe('');
    expect(productSummarySelect()).toContain('AND hp.id IN (:ids)');
    expect(productSummarySelect()).toContain(
      'LEFT JOIN product_cost_history cc ON cc.product_id = p.id AND cc.effective_from = pcs.currentFrom',
    );
  });

  it('the order line total is computed by MySQL in DECIMAL and returned as text', () => {
    expect(ORDER_COST_COLUMNS).toContain(
      'CAST(pc.unit_cost * o.quantity AS CHAR) AS costTotal',
    );
  });
});

describe('mapping SQL', () => {
  it('creates products only for SKUs without one, never updates an existing product, in SKU order', () => {
    const sql = createMissingProductsSql(true);
    expect(sql).toMatch(/^INSERT INTO products/);
    expect(sql).toContain('ep.id IS NULL');
    expect(sql).toContain('o.sku IS NOT NULL');
    expect(sql).toContain('je.import_job_id = :importJobId');
    expect(sql).toContain('ORDER BY src.sku');
    expect(sql).not.toMatch(/ON DUPLICATE KEY|UPDATE products/);
    expect(createMissingProductsSql(false)).not.toContain('importJobId');
  });

  it('re-links by exact SKU and writes only rows that differ (NULL-safe), so a second pass is a no-op', () => {
    const job = relinkOrdersSql(true);
    expect(job).toContain(
      'LEFT JOIN products p ON p.seller_account_id = o.seller_account_id AND p.sku = o.sku',
    );
    expect(job).toContain('SET o.product_id = p.id');
    expect(job).toContain('NOT (o.product_id <=> p.id)');
    expect(job).toContain('je.import_job_id = :importJobId');
    expect(relinkOrdersSql(false)).not.toContain('order_status_events');
    expect(LINK_SKU_SQL).toContain(
      'o.sku = :sku AND NOT (o.product_id <=> :productId)',
    );
  });

  it('import pass also re-links every account order carrying one of the job SKUs (not only the job orders)', () => {
    expect(JOB_SKUS_SQL).toMatch(/^SELECT DISTINCT o\.sku/);
    expect(JOB_SKUS_SQL).toContain('je.import_job_id = :importJobId');
    expect(RELINK_SKUS_SQL).not.toContain('order_status_events');
    expect(RELINK_SKUS_SQL).toContain(
      'o.sku IN (:skus) AND NOT (o.product_id <=> p.id)',
    );
  });
});

describe('product list SQL', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });

  it('ORDER BY from the allowlist; id tie-break; name and cost put missing values last both ways', () => {
    expect(productOrderBy('sku')).toBe('p.sku ASC, p.id ASC');
    expect(productOrderBy('-sku')).toBe('p.sku DESC, p.id DESC');
    expect(productOrderBy('-orderCount')).toBe(
      'COALESCE(poc.orderCount, 0) DESC, p.id DESC',
    );
    // What each sort reads: sku / name nothing (ids-first paging skips the statistics), orderCount only
    // the order counts, currentUnitCost only the cost pass.
    expect(sortNeeds('sku')).toEqual({ costs: false, orders: 'none' });
    expect(sortNeeds('-name')).toEqual({ costs: false, orders: 'none' });
    expect(sortNeeds('-orderCount')).toEqual({ costs: false, orders: 'count' });
    expect(sortNeeds('currentUnitCost')).toEqual({
      costs: true,
      orders: 'none',
    });
    expect(productOrderBy('name')).toBe('p.name IS NULL, p.name ASC, p.id ASC');
    expect(productOrderBy('-currentUnitCost')).toBe(
      'cc.unit_cost IS NULL, cc.unit_cost DESC, p.id DESC',
    );
    expect(PRODUCT_SORTS).toEqual([
      'sku',
      '-sku',
      'name',
      '-name',
      'orderCount',
      '-orderCount',
      'currentUnitCost',
      '-currentUnitCost',
    ]);
  });

  it('filters: account scope, status (all = no filter), escaped search, cost missing / known', () => {
    const filter = productListFilter(scope, '2026-10-31', {
      status: 'archived',
      q: 'KUR_%',
      cost: 'missing',
    });
    expect(filter.conditions).toEqual([
      'p.seller_account_id = :sellerAccountId',
      'p.workspace_id = :workspaceId',
      'p.status = :status',
      "(p.sku LIKE :qPrefix ESCAPE '!' OR p.name LIKE :qContains ESCAPE '!')",
      'cc.id IS NULL',
    ]);
    expect(filter.replacements).toEqual({
      sellerAccountId: 3,
      workspaceId: 2,
      today: '2026-10-31',
      status: 'archived',
      qPrefix: 'KUR!_!%%',
      qContains: '%KUR!_!%%',
    });
    const all = productListFilter(scope, '2026-10-31', {
      status: 'all',
      cost: 'known',
    });
    expect(all.conditions.slice(2)).toEqual(['cc.id IS NOT NULL']);
    expect([filter.needs, all.needs]).toEqual([
      { costs: true, orders: 'none' },
      { costs: true, orders: 'none' },
    ]);
    expect(
      productListFilter(scope, '2026-10-31', { status: 'active', q: 'x' })
        .needs,
    ).toEqual({ costs: false, orders: 'none' });
    expect(
      productListFilter(scope, '2026-10-31', {
        status: 'all',
        cost: 'incomplete',
      }).needs,
    ).toEqual({ costs: false, orders: 'full' });
  });

  it('cost=incomplete: an order of the product without a cost on its own order date (same rule as ordersWithoutCost)', () => {
    const filter = productListFilter(scope, '2026-10-31', {
      status: 'active',
      cost: 'incomplete',
    });
    expect(filter.conditions[3]).toBe(INCOMPLETE_SQL);
    expect(INCOMPLETE_SQL).toBe('poc.ordersWithoutCost > 0');
  });

  it('maps a summary row: ids as strings, counts as numbers, currentCost null when unknown', () => {
    const base = {
      id: 7,
      workspaceId: 2,
      sellerAccountId: 3,
      sku: 'KUR-RED',
      name: null,
      catalogId: 'CAT-1',
      status: 'active' as const,
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      updatedAt: new Date('2026-10-30T11:00:00.000Z'),
      orderCount: 4,
      ordersWithoutCost: '1',
      costCount: 2,
    };
    expect(
      toProductSummaryDto({
        ...base,
        currentUnitCost: '600.2500',
        currentEffectiveFrom: '2026-10-05',
      }),
    ).toEqual({
      id: '7',
      workspaceId: '2',
      sellerAccountId: '3',
      sku: 'KUR-RED',
      name: null,
      catalogId: 'CAT-1',
      status: 'active',
      orderCount: 4,
      ordersWithoutCost: 1,
      currentCost: { unitCost: '600.2500', effectiveFrom: '2026-10-05' },
      costCount: 2,
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-30T11:00:00.000Z',
    });
    expect(
      toProductSummaryDto({
        ...base,
        currentUnitCost: null,
        currentEffectiveFrom: null,
      }).currentCost,
    ).toBeNull();
  });
});

describe('product DTOs (through the global ValidationPipe)', () => {
  it('list query: defaults sort sku / status active; allowlisted sort, status and cost; unknown params rejected', async () => {
    const dto = await accept(ListProductsQueryDto, {}, 'query');
    expect(dto).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        sort: 'sku',
        status: 'active',
      }),
    );
    expect(dto.cost).toBeUndefined();
    const set = await accept(
      ListProductsQueryDto,
      { sort: '-currentUnitCost', status: 'all', cost: 'missing', q: '  kur ' },
      'query',
    );
    expect([set.sort, set.status, set.cost, set.q]).toEqual([
      '-currentUnitCost',
      'all',
      'missing',
      'kur',
    ]);
    expect(
      Object.keys(
        await reject(
          ListProductsQueryDto,
          {
            sort: 'price',
            status: 'deleted',
            cost: 'maybe',
            pageSize: '101',
            page: '2001',
          },
          'query',
        ),
      ).sort(),
    ).toEqual(['cost', 'page', 'pageSize', 'sort', 'status']);
    expect(
      Object.keys(
        await reject(ListProductsQueryDto, { sellerAccountId: '9' }, 'query'),
      ),
    ).toEqual(['sellerAccountId']);
  });

  it('create: SKU cleaned like the importer (format characters removed, spaces collapsed), 1–128; blank name → null', async () => {
    const dto = await accept(CreateProductDto, {
      sku: '  KUR​-RED   M ',
      name: '   ',
      catalogId: ' CAT-1 ',
    });
    expect(dto).toEqual({ sku: 'KUR-RED M', name: null, catalogId: 'CAT-1' });
    expect(Object.keys(await reject(CreateProductDto, { sku: '   ' }))).toEqual(
      ['sku'],
    );
    expect(Object.keys(await reject(CreateProductDto, {}))).toEqual(['sku']);
    expect(
      Object.keys(await reject(CreateProductDto, { sku: 'x'.repeat(129) })),
    ).toEqual(['sku']);
    expect(
      Object.keys(
        await reject(CreateProductDto, {
          sku: 'A',
          name: 'n'.repeat(513),
          catalogId: 'c'.repeat(65),
        }),
      ).sort(),
    ).toEqual(['catalogId', 'name']);
    expect(
      Object.keys(await reject(CreateProductDto, { sku: 'A', status: 'x' })),
    ).toEqual(['status']);
  });

  it('update: name may be null (clears), status allowlisted, the SKU cannot be sent', async () => {
    expect(await accept(UpdateProductDto, { name: null })).toEqual({
      name: null,
    });
    expect(await accept(UpdateProductDto, { status: 'archived' })).toEqual({
      status: 'archived',
    });
    expect(await accept(UpdateProductDto, {})).toEqual({});
    expect(
      Object.keys(await reject(UpdateProductDto, { status: null })),
    ).toEqual(['status']);
    expect(
      Object.keys(await reject(UpdateProductDto, { status: 'deleted' })),
    ).toEqual(['status']);
    expect(Object.keys(await reject(UpdateProductDto, { sku: 'B' }))).toEqual([
      'sku',
    ]);
  });

  it('cost: ≤ 4 decimals, 0 allowed, < 100000000, no negatives; a JSON number is accepted as its text', async () => {
    const today = todayInIndia();
    expect(
      await accept(AddCostDto, { effectiveFrom: today, unitCost: 549.5 }),
    ).toEqual({ effectiveFrom: today, unitCost: '549.5' });
    expect(
      (await accept(AddCostDto, { effectiveFrom: today, unitCost: '0' }))
        .unitCost,
    ).toBe('0');
    expect(
      (
        await accept(AddCostDto, {
          effectiveFrom: today,
          unitCost: '99999999.9999',
          note: '  lot of 3 ',
        })
      ).note,
    ).toBe('lot of 3');
    for (const unitCost of ['1.12345', '100000000', '-1', '', 'abc', 1e21]) {
      expect({
        unitCost,
        fields: Object.keys(
          await reject(AddCostDto, { effectiveFrom: today, unitCost }),
        ),
      }).toEqual({ unitCost, fields: ['unitCost'] });
    }
    expect(
      await reject(AddCostDto, { effectiveFrom: today, unitCost: '1.12345' }),
    ).toEqual({ unitCost: ['unitCost must have at most 4 decimal places'] });
  });

  it('cost date: a real YYYY-MM-DD, at most 366 days after today (India)', async () => {
    const today = todayInIndia();
    for (const effectiveFrom of ['2020-01-01', today, addDays(today, 366)]) {
      expect(
        (await accept(AddCostDto, { effectiveFrom, unitCost: '1' }))
          .effectiveFrom,
      ).toBe(effectiveFrom);
    }
    expect(
      await reject(AddCostDto, {
        effectiveFrom: addDays(today, 367),
        unitCost: '1',
      }),
    ).toEqual({
      effectiveFrom: [
        'effectiveFrom must not be more than 366 days after today (India time)',
      ],
    });
    for (const effectiveFrom of ['2026-02-30', '01-10-2026', '', null]) {
      expect(
        Object.keys(await reject(AddCostDto, { effectiveFrom, unitCost: '1' })),
      ).toEqual(['effectiveFrom']);
    }
    expect(
      Object.keys(
        await reject(AddCostDto, {
          effectiveFrom: today,
          unitCost: '1',
          note: 'n'.repeat(256),
        }),
      ),
    ).toEqual(['note']);
  });
});
