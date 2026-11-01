import type { CreationAttributes, Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { scopeOf, type AccountScope } from '../../src/common/sql/account-scope';
import { Order, Product, ProductCostHistory } from '../../src/database/models';
import { orderScope, pageOfOrders } from '../../src/orders/order-queries';
import { ProductMappingService } from '../../src/products/product-mapping.service';
import { findProductSummary } from '../../src/products/product-queries';
import {
  createImportJobWithRow,
  createOrder,
  createStatusEvent,
  createTestSequelize,
  inRollback,
  seedTenant,
  type Tenant,
} from './db-helpers';

/**
 * The effective-dated cost rule and the product ↔ order mapping SQL against the migrated meesho_test, every
 * case in a rolled-back transaction. The rule lives in SQL (src/products/effective-cost.ts), so its edge
 * cases are proved here against MySQL rather than against a JS copy.
 */
describe('products: effective cost and mapping (meesho_test)', () => {
  let sequelize: Sequelize;
  let mapping: ProductMappingService;

  beforeAll(() => {
    sequelize = createTestSequelize();
    mapping = new ProductMappingService(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  const scopeOfTenant = (tenant: Tenant): AccountScope =>
    scopeOf({ id: tenant.account.id, workspaceId: tenant.workspace.id });

  const cost = (
    tenant: Tenant,
    product: Product,
    effectiveFrom: string,
    unitCost: string,
    t: Transaction,
  ) =>
    ProductCostHistory.create(
      {
        productId: product.id,
        effectiveFrom,
        unitCost,
        createdByUserId: tenant.user.id,
      },
      { transaction: t },
    );

  /** Every order of the tenant as [subOrderNo, productCost] through the real list query. */
  async function costs(tenant: Tenant, t: Transaction) {
    const scope = scopeOfTenant(tenant);
    const { items } = await pageOfOrders(
      sequelize,
      scope,
      orderScope(scope),
      'o.sub_order_no ASC, o.id ASC',
      { limit: 100, offset: 0 },
      t,
    );
    return items.map((o) => [o.subOrderNo, o.productId, o.productCost]);
  }

  it('unit cost on the ORDER date = greatest effective_from <= date; before the first cost unknown; future costs only from their date; totals exact', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('cost-rule', t);
      const p = a.product;
      await cost(a, p, '2026-10-02', '549.5', t);
      await cost(a, p, '2026-10-05', '600.25', t);
      await cost(a, p, '2027-01-01', '700', t);
      const lot = await Product.create(
        {
          workspaceId: a.workspace.id,
          sellerAccountId: a.account.id,
          sku: 'LOT-3',
        },
        { transaction: t },
      );
      await cost(a, lot, '2026-01-01', '333.3333', t);
      const order = (
        subOrderNo: string,
        orderDate: string,
        quantity: number,
        product: Product | null,
      ) =>
        createOrder(a, t, {
          subOrderNo,
          orderDate,
          quantity,
          productId: product?.id ?? null,
          sku: product?.sku ?? null,
        });
      await order('O1', '2026-10-01', 2, p);
      await order('O2', '2026-10-02', 2, p);
      await order('O3', '2026-10-04', 1, p);
      await order('O4', '2026-10-05', 3, p);
      await order('O5', '2026-12-31', 1, p);
      await order('O6', '2027-01-01', 1, p);
      await order('O7', '2026-10-03', 1, null);
      await order('O8', '2026-10-03', 3, lot);
      const pid = String(p.id);
      expect(await costs(a, t)).toEqual([
        // the day before the first cost
        [
          'O1',
          pid,
          {
            state: 'unknown',
            unitCost: null,
            effectiveFrom: null,
            total: null,
          },
        ],
        // exactly on the first boundary: 2 × 549.5000
        [
          'O2',
          pid,
          {
            state: 'known',
            unitCost: '549.5000',
            effectiveFrom: '2026-10-02',
            total: '1099.0000',
          },
        ],
        // between two costs
        [
          'O3',
          pid,
          {
            state: 'known',
            unitCost: '549.5000',
            effectiveFrom: '2026-10-02',
            total: '549.5000',
          },
        ],
        // exactly on the second boundary: 3 × 600.2500
        [
          'O4',
          pid,
          {
            state: 'known',
            unitCost: '600.2500',
            effectiveFrom: '2026-10-05',
            total: '1800.7500',
          },
        ],
        // the day before a future-dated cost: still the earlier one
        [
          'O5',
          pid,
          {
            state: 'known',
            unitCost: '600.2500',
            effectiveFrom: '2026-10-05',
            total: '600.2500',
          },
        ],
        // from the future cost's own date
        [
          'O6',
          pid,
          {
            state: 'known',
            unitCost: '700.0000',
            effectiveFrom: '2027-01-01',
            total: '700.0000',
          },
        ],
        [
          'O7',
          null,
          {
            state: 'no_product',
            unitCost: null,
            effectiveFrom: null,
            total: null,
          },
        ],
        // lot-based cost 1000/3: 3 × 333.3333 = 999.9999 exactly (not rounded to 1000.00)
        [
          'O8',
          String(lot.id),
          {
            state: 'known',
            unitCost: '333.3333',
            effectiveFrom: '2026-01-01',
            total: '999.9999',
          },
        ],
      ]);
    }));

  it('a zero cost is known (0.0000), and an order of another product never borrows a cost', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('cost-zero', t);
      const other = await Product.create(
        {
          workspaceId: a.workspace.id,
          sellerAccountId: a.account.id,
          sku: 'NO-COST',
        },
        { transaction: t },
      );
      await cost(a, a.product, '2026-10-01', '0', t);
      await createOrder(a, t, {
        subOrderNo: 'Z1',
        orderDate: '2026-10-09',
        quantity: 4,
        productId: a.product.id,
        sku: 'SKU-1',
      });
      await createOrder(a, t, {
        subOrderNo: 'Z2',
        orderDate: '2026-10-09',
        quantity: 4,
        productId: other.id,
        sku: 'NO-COST',
      });
      expect((await costs(a, t)).map(([no, , c]) => [no, c])).toEqual([
        [
          'Z1',
          {
            state: 'known',
            unitCost: '0.0000',
            effectiveFrom: '2026-10-01',
            total: '0.0000',
          },
        ],
        [
          'Z2',
          {
            state: 'unknown',
            unitCost: null,
            effectiveFrom: null,
            total: null,
          },
        ],
      ]);
    }));

  it('product summary: current cost on the given India date (future ones ignored until then), order counts, orders without cost', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('cost-summary', t);
      const p = a.product;
      await cost(a, p, '2026-10-02', '549.5', t);
      await cost(a, p, '2026-10-05', '600.25', t);
      await cost(a, p, '2027-01-01', '700', t);
      await createOrder(a, t, {
        subOrderNo: 'S1',
        orderDate: '2026-10-01',
        productId: p.id,
        sku: 'SKU-1',
      });
      await createOrder(a, t, {
        subOrderNo: 'S2',
        orderDate: '2026-10-02',
        productId: p.id,
        sku: 'SKU-1',
      });
      await createOrder(a, t, {
        subOrderNo: 'S3',
        orderDate: '2026-09-30',
        productId: p.id,
        sku: 'SKU-1',
      });
      const scope = scopeOfTenant(a);
      const on = (today: string) =>
        findProductSummary(sequelize, scope, p.id, today, t);
      expect((await on('2026-10-01'))?.currentCost).toBeNull();
      expect((await on('2026-10-02'))?.currentCost).toEqual({
        unitCost: '549.5000',
        effectiveFrom: '2026-10-02',
      });
      expect((await on('2026-12-31'))?.currentCost).toEqual({
        unitCost: '600.2500',
        effectiveFrom: '2026-10-05',
      });
      expect((await on('2027-01-01'))?.currentCost).toEqual({
        unitCost: '700.0000',
        effectiveFrom: '2027-01-01',
      });
      expect(await on('2026-12-31')).toEqual(
        expect.objectContaining({
          orderCount: 3,
          ordersWithoutCost: 2,
          costCount: 3,
        }),
      );
      // Another account never sees it.
      const b = await seedTenant('cost-summary-b', t);
      expect(
        await findProductSummary(
          sequelize,
          scopeOfTenant(b),
          p.id,
          '2026-12-31',
          t,
        ),
      ).toBeNull();
    }));

  it('sync: one product per missing SKU (exact, case-sensitive; name from the latest named order), every order re-linked by SKU; a second pass changes nothing', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('map-sync', t);
      await a.product.update({ name: 'Edited by user' }, { transaction: t });
      const mk = (
        subOrderNo: string,
        sku: string | null,
        extra: Partial<CreationAttributes<Order>> = {},
      ) => createOrder(a, t, { subOrderNo, sku, ...extra });
      await mk('M1', 'A', {
        orderDate: '2026-10-01',
        productName: 'Old A',
        catalogId: 'C-OLD',
      });
      await mk('M2', 'A', {
        orderDate: '2026-10-03',
        productName: 'New A',
        catalogId: 'C-NEW',
      });
      await mk('M3', 'A', { orderDate: '2026-10-09', productName: null });
      await mk('M4', 'sku-1'); // not SKU-1: SKUs compare exactly
      await mk('M5', 'SKU-1', { productName: 'Imported name' });
      await mk('M6', null);
      // Wrongly linked (e.g. older code): SKU B but pointing at SKU-1's product.
      await mk('M7', 'B', { productId: a.product.id });

      const scope = scopeOfTenant(a);
      expect(await mapping.syncAccount(scope, t)).toEqual({
        createdProducts: 3, // A, B, sku-1
        linkedOrders: 6, // M1–M3 → A, M4 → sku-1, M5 → SKU-1, M7 → B (M6 stays NULL)
      });
      const products = await Product.findAll({
        where: { sellerAccountId: a.account.id },
        order: [['id', 'ASC']],
        transaction: t,
      });
      expect(
        products.map((p) => [p.sku, p.name, p.catalogId, p.status]),
      ).toEqual([
        ['SKU-1', 'Edited by user', null, 'active'], // never overwritten
        ['A', 'New A', 'C-NEW', 'active'], // inserted in SKU order (binary: A < B < sku-1)
        ['B', null, null, 'active'],
        ['sku-1', null, null, 'active'],
      ]);
      const idOf = new Map(products.map((p) => [p.sku, p.id]));
      const orders = await Order.findAll({
        where: { sellerAccountId: a.account.id },
        order: [['subOrderNo', 'ASC']],
        transaction: t,
      });
      expect(orders.map((o) => [o.subOrderNo, o.productId])).toEqual([
        ['M1', idOf.get('A')],
        ['M2', idOf.get('A')],
        ['M3', idOf.get('A')],
        ['M4', idOf.get('sku-1')],
        ['M5', idOf.get('SKU-1')],
        ['M6', null],
        ['M7', idOf.get('B')],
      ]);
      expect(await mapping.syncAccount(scope, t)).toEqual({
        createdProducts: 0,
        linkedOrders: 0,
      });

      // An order whose SKU disappears is unlinked by the rule.
      await Order.update(
        { sku: null },
        {
          where: { sellerAccountId: a.account.id, subOrderNo: 'M7' },
          transaction: t,
        },
      );
      expect(await mapping.syncAccount(scope, t)).toEqual({
        createdProducts: 0,
        linkedOrders: 1,
      });
    }));

  it('import pass: only the orders observed by that job (status events), and products only for their SKUs', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('map-job', t);
      const { job, row } = await createImportJobWithRow(a, t);
      const inJob = await createOrder(a, t, {
        subOrderNo: 'J1',
        sku: 'IN-JOB',
      });
      const moved = await createOrder(a, t, {
        subOrderNo: 'J2',
        sku: 'SKU-1',
        productId: null,
      });
      await createOrder(a, t, { subOrderNo: 'J3', sku: 'NOT-IN-JOB' });
      for (const o of [inJob, moved]) {
        await createStatusEvent(a, o, t, {
          importJobId: job.id,
          importRowId: row.id,
        });
      }
      expect(
        await mapping.mapImportedOrders(scopeOfTenant(a), job.id, t),
      ).toEqual({
        createdProducts: 1,
        linkedOrders: 2,
      });
      expect(
        (
          await Product.findAll({
            where: { sellerAccountId: a.account.id },
            order: [['sku', 'ASC']],
            transaction: t,
          })
        ).map((p) => p.sku),
      ).toEqual(['IN-JOB', 'SKU-1']);
      const j3 = await Order.findOne({
        where: { sellerAccountId: a.account.id, subOrderNo: 'J3' },
        transaction: t,
      });
      expect(j3?.productId).toBeNull();
    }));

  it('import pass: orders OUTSIDE the job (imported before M6) that carry a SKU of the job are linked too; other SKUs stay unlinked', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('map-job-old', t);
      // Imported before products existed: no product X, links NULL.
      await createOrder(a, t, {
        subOrderNo: 'OLD-1',
        sku: 'X',
        orderDate: '2026-09-01',
      });
      await createOrder(a, t, {
        subOrderNo: 'OLD-2',
        sku: 'X',
        orderDate: '2026-09-02',
      });
      await createOrder(a, t, { subOrderNo: 'OLD-3', sku: 'Y' });
      // Imported before M6 with an existing product's SKU, still unlinked.
      await createOrder(a, t, { subOrderNo: 'OLD-4', sku: 'SKU-1' });
      const { job, row } = await createImportJobWithRow(a, t);
      const fresh = await createOrder(a, t, { subOrderNo: 'NEW-1', sku: 'X' });
      const another = await createOrder(a, t, {
        subOrderNo: 'NEW-2',
        sku: 'SKU-1',
      });
      for (const o of [fresh, another]) {
        await createStatusEvent(a, o, t, {
          importJobId: job.id,
          importRowId: row.id,
        });
      }
      const scope = scopeOfTenant(a);
      expect(await mapping.mapImportedOrders(scope, job.id, t)).toEqual({
        createdProducts: 1, // X
        linkedOrders: 5, // NEW-1, NEW-2 (job) + OLD-1, OLD-2 (X) + OLD-4 (SKU-1)
      });
      const x = await Product.findOne({
        where: { sellerAccountId: a.account.id, sku: 'X' },
        transaction: t,
      });
      const orders = await Order.findAll({
        where: { sellerAccountId: a.account.id },
        order: [['subOrderNo', 'ASC']],
        transaction: t,
      });
      expect(orders.map((o) => [o.subOrderNo, o.productId])).toEqual([
        ['NEW-1', x?.id],
        ['NEW-2', a.product.id],
        ['OLD-1', x?.id],
        ['OLD-2', x?.id],
        ['OLD-3', null], // SKU Y is not in this job: it waits for sync / a later import with Y
        ['OLD-4', a.product.id],
      ]);
      // X's summary now counts the old orders (and so would see costs entered on X).
      await cost(a, x as Product, '2026-09-02', '10', t);
      expect(
        await findProductSummary(
          sequelize,
          scope,
          (x as Product).id,
          '2026-10-31',
          t,
        ),
      ).toEqual(
        expect.objectContaining({ orderCount: 3, ordersWithoutCost: 1 }),
      );
      expect(await mapping.mapImportedOrders(scope, job.id, t)).toEqual({
        createdProducts: 0,
        linkedOrders: 0,
      });
    }));

  it('a manual product links exactly the orders with its SKU', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('map-manual', t);
      await createOrder(a, t, { subOrderNo: 'K1', sku: 'NEW' });
      await createOrder(a, t, { subOrderNo: 'K2', sku: 'NEW' });
      await createOrder(a, t, { subOrderNo: 'K3', sku: 'new' });
      const product = await Product.create(
        {
          workspaceId: a.workspace.id,
          sellerAccountId: a.account.id,
          sku: 'NEW',
        },
        { transaction: t },
      );
      const scope = scopeOfTenant(a);
      expect(await mapping.linkSku(scope, product.id, 'NEW', t)).toBe(2);
      expect(await mapping.linkSku(scope, product.id, 'NEW', t)).toBe(0);
    }));
});
