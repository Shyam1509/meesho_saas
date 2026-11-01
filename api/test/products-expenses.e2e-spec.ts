import { QueryTypes } from 'sequelize';
import request, { type Response } from 'supertest';
import { addDays, todayInIndia } from '../src/common/time/india-date';
import { WorkspaceMember } from '../src/database/models';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
  TEST_CLIENT_IP_HEADER,
} from './support/e2e-app';
import { csv, type Cell } from './support/import-fixtures';
import { type ErrorBody, TestClient } from './support/test-client';

const PASSWORD = 'correct horse battery';

interface UserRef {
  id: string;
  displayName: string | null;
  email: string;
}

interface ProductCost {
  state: 'known' | 'unknown' | 'no_product';
  unitCost: string | null;
  effectiveFrom: string | null;
  total: string | null;
}

interface OrderSummary {
  id: string;
  subOrderNo: string;
  orderDate: string;
  quantity: number;
  sku: string | null;
  productId: string | null;
  productCost: ProductCost;
}

interface CostEntry {
  id: string;
  unitCost: string;
  effectiveFrom: string;
  note: string | null;
  createdBy: UserRef;
  createdAt: string;
}

interface ProductSummary {
  id: string;
  workspaceId: string;
  sellerAccountId: string;
  sku: string;
  name: string | null;
  catalogId: string | null;
  status: string;
  orderCount: number;
  ordersWithoutCost: number;
  currentCost: { unitCost: string; effectiveFrom: string } | null;
  costCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProductDetail extends ProductSummary {
  costHistory: CostEntry[];
}

interface Expense {
  id: string;
  workspaceId: string;
  sellerAccountId: string | null;
  scope: string;
  expenseDate: string;
  category: string;
  categoryLabel: string;
  description: string | null;
  amount: string;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface ExpensePage extends Page<Expense> {
  totals: { amount: string | null; count: number };
}

interface AuditRow {
  action: string;
  actorUserId: number;
  workspaceId: number;
  sellerAccountId: number | null;
  beforeData: unknown;
  afterData: unknown;
}

const ORDER_HEADER = [
  'Sub Order No',
  'Order Date',
  'Reason for Credit Entry',
  'Quantity',
  'SKU',
  'Product Name',
  'Catalog ID',
];

const KNOWN = (
  unitCost: string,
  effectiveFrom: string,
  total: string,
): ProductCost => ({ state: 'known', unitCost, effectiveFrom, total });
const UNKNOWN: ProductCost = {
  state: 'unknown',
  unitCost: null,
  effectiveFrom: null,
  total: null,
};
const NO_PRODUCT: ProductCost = {
  state: 'no_product',
  unitCost: null,
  effectiveFrom: null,
  total: null,
};

/**
 * Products, effective-dated costs and expenses (Milestone 6) against meesho_test, orders created through the
 * real import endpoints. Hand-checked fixture:
 *
 * Account "Shop" (A1, workspace A, owner Alice; Carol is a member of A):
 *   orders-1.csv (as of 10 Oct): SO-1 01-10 ×2 KUR-RED | SO-2 02-10 ×2 KUR-RED | SO-3 04-10 ×1 KUR-RED |
 *     SO-4 05-10 ×3 KUR-RED | SO-5 06-10 ×1 SAR-GRN | SO-6 03-10 ×1 (no SKU) | SO-7 07-10 ×1 MUG-01
 *   orders-2.csv (as of 12 Oct): SO-7 → SKU MUG-02 (new product), SO-5 again with another product name.
 *   Costs: KUR-RED 549.5 from 02-10, 600.25 from 05-10, 700 from today+10; SAR-GRN 0 from 01-10;
 *          MUG-01 1 from today+366.
 *   Order costs: SO-1 unknown (before the first cost) | SO-2 2 × 549.5000 = 1099.0000 (on the boundary) |
 *     SO-3 549.5000 | SO-4 3 × 600.2500 = 1800.7500 (on the boundary) | SO-5 0.0000 (zero cost is known) |
 *     SO-6 no_product | SO-7 unknown (MUG-02 has no cost). After deleting the 05-10 cost: SO-4 3 × 549.5 = 1648.5000.
 * Account "Legacy" (A2, workspace A): orders imported, then products removed and links cleared in the DB
 *   (the pre-M6 state) → manual product + sync.
 * Expenses: A1 E1 05-10 packaging 1200.50, E2 10-10 staff 15000.00, E3 20-10 other 99.99 (= 16300.49);
 *   A2 E4 08-10 packaging 300.00; workspace A W1 01-10 rent 25000.00, W2 15-10 software 499.50 (= 25499.50);
 *   all of workspace A = 42099.99.
 * Bob owns workspace B and is a stranger to A.
 */
describe('products, costs and expenses (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;
  const today = todayInIndia();

  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  let aliceId: string;
  let wsA: string;
  let wsB: string;
  let a1: string;
  let a2: string;
  let b1: string;
  let ipSeq = 0;

  /** Product ids of A1 by SKU. */
  const productIds: Record<string, string> = {};
  /** Cost entry ids by label. */
  const costIds: Record<string, string> = {};
  /** Expense ids by label. */
  const expenseIds: Record<string, string> = {};

  async function register(label: string, workspaceName: string) {
    const client = new TestClient(ctx.server);
    const res = await client.register(email(label), PASSWORD, {
      displayName: label,
      workspaceName,
    });
    expect(res.status).toBe(201);
    return {
      client,
      me: res.body as { user: { id: string }; workspaces: { id: string }[] },
    };
  }

  async function createAccount(
    client: TestClient,
    workspaceId: string,
    name: string,
  ): Promise<string> {
    const res = await client.post(`/workspaces/${workspaceId}/accounts`, {
      displayName: name,
    });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  function expectError(
    res: Response,
    status: number,
    code: string,
  ): ErrorBody['error'] {
    expect({
      status: res.status,
      code: (res.body as ErrorBody).error?.code,
    }).toEqual({ status, code });
    return (res.body as ErrorBody).error;
  }

  const fieldsOf = (res: Response) =>
    ((res.body as ErrorBody).error.details ?? []).map((d) => d.field);

  function ok<T>(res: Response, status = 200): T {
    expect({
      status: res.status,
      body: res.status === status ? null : (res.body as unknown),
    }).toEqual({ status, body: null });
    return res.body as T;
  }

  /** Upload (fresh client IP: the per-IP upload throttle) + confirm → completed; returns the job id. */
  async function importOrders(
    accountId: string,
    name: string,
    rows: Cell[][],
    dataAsOf: string,
  ): Promise<string> {
    ipSeq += 1;
    const uploaded = await alice.upload(
      `/accounts/${accountId}/imports`,
      { name, content: csv([ORDER_HEADER, ...rows]) },
      { dataAsOf },
      { headers: { [TEST_CLIENT_IP_HEADER]: `10.66.0.${ipSeq}` } },
    );
    const id = ok<{ id: string }>(uploaded, 201).id;
    const confirmed = await alice.post(`/imports/${id}/confirm`, {});
    expect({
      status: confirmed.status,
      jobStatus: (confirmed.body as { status: string }).status,
    }).toEqual({ status: 200, jobStatus: 'completed' });
    return id;
  }

  async function auditOf(
    entityType: string,
    entityId: string,
  ): Promise<AuditRow[]> {
    return ctx.sequelize.query<AuditRow>(
      `SELECT action, actor_user_id AS actorUserId, workspace_id AS workspaceId,
              seller_account_id AS sellerAccountId, before_data AS beforeData, after_data AS afterData
       FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id`,
      { replacements: [entityType, entityId], type: QueryTypes.SELECT },
    );
  }

  async function products(
    query = '',
    accountId = a1,
    client = alice,
  ): Promise<Page<ProductSummary>> {
    return ok<Page<ProductSummary>>(
      await client.get(`/accounts/${accountId}/products${query}`),
    );
  }

  const skus = (page: Page<ProductSummary>) => page.items.map((p) => p.sku);

  async function product(id: string): Promise<ProductDetail> {
    return ok<ProductDetail>(await alice.get(`/products/${id}`));
  }

  /** Every order of the account as [subOrderNo, productId, productCost], by sub order no. */
  async function orderCosts(accountId = a1) {
    const page = ok<Page<OrderSummary>>(
      await alice.get(`/accounts/${accountId}/orders?sort=subOrderNo`),
    );
    return page.items.map((o) => [o.subOrderNo, o.productId, o.productCost]);
  }

  async function expenses(path: string, client = alice): Promise<ExpensePage> {
    return ok<ExpensePage>(await client.get(path));
  }

  const labelsOf = (page: Page<Expense>) =>
    page.items.map(
      (e) => Object.entries(expenseIds).find(([, id]) => id === e.id)?.[0],
    );

  beforeAll(async () => {
    ctx = await createE2eApp();
    const a = await register('alice', 'M6 A');
    const b = await register('bob', 'M6 B');
    const c = await register('carol', 'M6 Carol');
    alice = a.client;
    bob = b.client;
    carol = c.client;
    aliceId = a.me.user.id;
    wsA = a.me.workspaces[0].id;
    wsB = b.me.workspaces[0].id;
    await WorkspaceMember.create({
      workspaceId: Number(wsA),
      userId: Number(c.me.user.id),
      role: 'member',
    });
    a1 = await createAccount(alice, wsA, 'Shop');
    a2 = await createAccount(alice, wsA, 'Legacy');
    b1 = await createAccount(bob, wsB, 'Bob shop');
  }, 60_000);

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  describe('import confirm creates products and maps orders by SKU', () => {
    it('orders-1: one product per new SKU (name / catalog id from the report), every order with a SKU linked', async () => {
      const job = await importOrders(
        a1,
        'orders-1.csv',
        [
          [
            'SO-1',
            '01-10-2026',
            'DELIVERED',
            '2',
            'KUR-RED',
            'Red Kurti',
            'CAT-1',
          ],
          [
            'SO-2',
            '02-10-2026',
            'DELIVERED',
            '2',
            'KUR-RED',
            'Red Kurti',
            'CAT-1',
          ],
          [
            'SO-3',
            '04-10-2026',
            'SHIPPED',
            '1',
            'KUR-RED',
            'Red Kurti',
            'CAT-1',
          ],
          [
            'SO-4',
            '05-10-2026',
            'SHIPPED',
            '3',
            'KUR-RED',
            'Red Kurti',
            'CAT-1',
          ],
          [
            'SO-5',
            '06-10-2026',
            'DELIVERED',
            '1',
            'SAR-GRN',
            'Green Saree',
            'CAT-2',
          ],
          ['SO-6', '03-10-2026', 'RTO', '1', null, null, null],
          ['SO-7', '07-10-2026', 'SHIPPED', '1', 'MUG-01', 'Coffee Mug', null],
        ],
        '2026-10-10',
      );
      const [audit] = await auditOf('import_job', job);
      expect(audit.afterData).toEqual(
        expect.objectContaining({ createdProducts: 3, linkedOrders: 6 }),
      );

      const list = await products('?status=all');
      expect(
        list.items.map((p) => [
          p.sku,
          p.name,
          p.catalogId,
          p.status,
          p.orderCount,
        ]),
      ).toEqual([
        ['KUR-RED', 'Red Kurti', 'CAT-1', 'active', 4],
        ['MUG-01', 'Coffee Mug', null, 'active', 1],
        ['SAR-GRN', 'Green Saree', 'CAT-2', 'active', 1],
      ]);
      for (const p of list.items) productIds[p.sku] = p.id;
      expect(list.items.every((p) => p.sellerAccountId === a1)).toBe(true);
      expect((await orderCosts()).map(([no, id]) => [no, id])).toEqual([
        ['SO-1', productIds['KUR-RED']],
        ['SO-2', productIds['KUR-RED']],
        ['SO-3', productIds['KUR-RED']],
        ['SO-4', productIds['KUR-RED']],
        ['SO-5', productIds['SAR-GRN']],
        ['SO-6', null],
        ['SO-7', productIds['MUG-01']],
      ]);
    });

    it('a member renames a product (audit product.updated with the changed field)', async () => {
      const res = await carol.patch(`/products/${productIds['SAR-GRN']}`, {
        name: '  Saree   (edited) ',
      });
      expect(ok<ProductDetail>(res).name).toBe('Saree (edited)');
      expect(await auditOf('product', productIds['SAR-GRN'])).toEqual([
        expect.objectContaining({
          action: 'product.updated',
          sellerAccountId: Number(a1),
          beforeData: { name: 'Green Saree' },
          afterData: { name: 'Saree (edited)' },
        }),
      ]);
    });

    it('orders-2: an order whose SKU changed moves to the (new) right product; an edited name is never overwritten', async () => {
      const job = await importOrders(
        a1,
        'orders-2.csv',
        [
          [
            'SO-7',
            '07-10-2026',
            'DELIVERED',
            '1',
            'MUG-02',
            'Coffee Mug v2',
            null,
          ],
          [
            'SO-5',
            '06-10-2026',
            'DELIVERED',
            '1',
            'SAR-GRN',
            'Green Saree NEW',
            'CAT-2',
          ],
        ],
        '2026-10-12',
      );
      const [audit] = await auditOf('import_job', job);
      expect(audit.afterData).toEqual(
        expect.objectContaining({ createdProducts: 1, linkedOrders: 1 }),
      );
      const list = await products('?status=all');
      expect(list.items.map((p) => [p.sku, p.name, p.orderCount])).toEqual([
        ['KUR-RED', 'Red Kurti', 4],
        ['MUG-01', 'Coffee Mug', 0],
        ['MUG-02', 'Coffee Mug v2', 1],
        ['SAR-GRN', 'Saree (edited)', 1],
      ]);
      productIds['MUG-02'] = list.items[2].id;
      const so7 = (await orderCosts()).find(([no]) => no === 'SO-7');
      expect(so7?.[1]).toBe(productIds['MUG-02']);
    });
  });

  describe('effective-dated costs', () => {
    it('owner adds a cost → 201 CostEntry with 4 decimals; audit product_cost.created', async () => {
      const res = await alice.post(
        `/products/${productIds['KUR-RED']}/cost-history`,
        { effectiveFrom: '2026-10-02', unitCost: '549.5', note: ' first lot ' },
      );
      const entry = ok<CostEntry>(res, 201);
      expect(entry).toEqual({
        id: expect.any(String) as string,
        unitCost: '549.5000',
        effectiveFrom: '2026-10-02',
        note: 'first lot',
        createdBy: { id: aliceId, displayName: 'alice', email: email('alice') },
        createdAt: expect.any(String) as string,
      });
      costIds.kur1 = entry.id;
      expect(await auditOf('product_cost', entry.id)).toEqual([
        {
          action: 'product_cost.created',
          actorUserId: Number(aliceId),
          workspaceId: Number(wsA),
          sellerAccountId: Number(a1),
          beforeData: null,
          afterData: {
            productId: productIds['KUR-RED'],
            sku: 'KUR-RED',
            effectiveFrom: '2026-10-02',
            unitCost: '549.5000',
            note: 'first lot',
          },
        },
      ]);
    });

    it('a member cannot add a cost (403); the same start date twice → 409 on effectiveFrom', async () => {
      expectError(
        await carol.post(`/products/${productIds['KUR-RED']}/cost-history`, {
          effectiveFrom: '2026-10-09',
          unitCost: '1',
        }),
        403,
        'FORBIDDEN',
      );
      const dup = await alice.post(
        `/products/${productIds['KUR-RED']}/cost-history`,
        { effectiveFrom: '2026-10-02', unitCost: '560' },
      );
      expectError(dup, 409, 'CONFLICT');
      expect(fieldsOf(dup)).toEqual(['effectiveFrom']);
    });

    it('more costs: a later one, a future-dated one, a zero cost; up to 366 days ahead', async () => {
      const add = async (sku: string, body: object) =>
        ok<CostEntry>(
          await alice.post(`/products/${productIds[sku]}/cost-history`, body),
          201,
        );
      const second = await add('KUR-RED', {
        effectiveFrom: '2026-10-05',
        unitCost: 600.25, // a JSON number is accepted
      });
      expect(second.unitCost).toBe('600.2500');
      costIds.kur2 = second.id;
      costIds.kurFuture = (
        await add('KUR-RED', {
          effectiveFrom: addDays(today, 10),
          unitCost: '700',
        })
      ).id;
      const zero = await add('SAR-GRN', {
        effectiveFrom: '2026-10-01',
        unitCost: '0',
      });
      expect(zero.unitCost).toBe('0.0000');
      costIds.sar = zero.id;
      costIds.mugFar = (
        await add('MUG-01', {
          effectiveFrom: addDays(today, 366),
          unitCost: '1',
        })
      ).id;
    });

    it('invalid costs → 400 naming the field (decimals, bounds, sign, dates more than 366 days ahead)', async () => {
      const url = `/products/${productIds['MUG-01']}/cost-history`;
      for (const [body, field] of [
        [{ effectiveFrom: '2026-10-01', unitCost: '1.12345' }, 'unitCost'],
        [{ effectiveFrom: '2026-10-01', unitCost: '-1' }, 'unitCost'],
        [{ effectiveFrom: '2026-10-01', unitCost: '100000000' }, 'unitCost'],
        [
          { effectiveFrom: addDays(today, 367), unitCost: '1' },
          'effectiveFrom',
        ],
        [{ effectiveFrom: '2026-02-30', unitCost: '1' }, 'effectiveFrom'],
        [{ effectiveFrom: '2026-10-01', unitCost: '1', extra: 1 }, 'extra'],
      ] as const) {
        const res = await alice.post(url, body);
        expectError(res, 400, 'VALIDATION_ERROR');
        expect({ body, fields: fieldsOf(res) }).toEqual({
          body,
          fields: [field],
        });
      }
    });

    it('orders: product cost = unit cost effective on the ORDER date × quantity (hand-checked); unknown and no_product never 0', async () => {
      const kur = productIds['KUR-RED'];
      expect(await orderCosts()).toEqual([
        ['SO-1', kur, UNKNOWN],
        ['SO-2', kur, KNOWN('549.5000', '2026-10-02', '1099.0000')],
        ['SO-3', kur, KNOWN('549.5000', '2026-10-02', '549.5000')],
        ['SO-4', kur, KNOWN('600.2500', '2026-10-05', '1800.7500')],
        [
          'SO-5',
          productIds['SAR-GRN'],
          KNOWN('0.0000', '2026-10-01', '0.0000'),
        ],
        ['SO-6', null, NO_PRODUCT],
        ['SO-7', productIds['MUG-02'], UNKNOWN],
      ]);
      const so4 = ok<Page<OrderSummary>>(
        await alice.get(`/accounts/${a1}/orders?q=SO-4`),
      ).items[0];
      const detail = ok<OrderSummary>(
        await alice.get(`/accounts/${a1}/orders/${so4.id}`),
      );
      expect([detail.productId, detail.productCost]).toEqual([
        kur,
        KNOWN('600.2500', '2026-10-05', '1800.7500'),
      ]);
      const withoutSettlement = ok<Page<OrderSummary>>(
        await alice.get(
          `/accounts/${a1}/reconciliation/orders-without-settlement?sort=subOrderNo&pageSize=2`,
        ),
      );
      expect(
        withoutSettlement.items.map((o) => [o.subOrderNo, o.productCost]),
      ).toEqual([
        ['SO-1', UNKNOWN],
        ['SO-2', KNOWN('549.5000', '2026-10-02', '1099.0000')],
      ]);
    });

    it('product list: counts, orders without cost, the cost effective TODAY (future costs ignored)', async () => {
      const list = await products();
      expect(list).toEqual(
        expect.objectContaining({ page: 1, pageSize: 25, total: 4 }),
      );
      expect(
        list.items.map((p) => [
          p.sku,
          p.orderCount,
          p.ordersWithoutCost,
          p.currentCost,
          p.costCount,
        ]),
      ).toEqual([
        [
          'KUR-RED',
          4,
          1,
          { unitCost: '600.2500', effectiveFrom: '2026-10-05' },
          3,
        ],
        ['MUG-01', 0, 0, null, 1],
        ['MUG-02', 1, 1, null, 0],
        [
          'SAR-GRN',
          1,
          0,
          { unitCost: '0.0000', effectiveFrom: '2026-10-01' },
          1,
        ],
      ]);
      // One source: the list and the detail agree.
      const detail = await product(productIds['KUR-RED']);
      const { costHistory, ...summary } = detail;
      expect(summary).toEqual(list.items[0]);
      expect([summary.workspaceId, summary.sellerAccountId]).toEqual([wsA, a1]);
      expect(costHistory.map((c) => [c.effectiveFrom, c.unitCost])).toEqual([
        [addDays(today, 10), '700.0000'],
        ['2026-10-05', '600.2500'],
        ['2026-10-02', '549.5000'],
      ]);
    });

    it('product list: cost filter, sorts (missing values last), search, paging, bad parameters', async () => {
      expect(skus(await products('?cost=missing'))).toEqual([
        'MUG-01',
        'MUG-02',
      ]);
      expect(skus(await products('?cost=known'))).toEqual([
        'KUR-RED',
        'SAR-GRN',
      ]);
      // ordersWithoutCost > 0: KUR-RED (SO-1 before its first cost) and MUG-02 (SO-7, no cost at all).
      expect(skus(await products('?cost=incomplete'))).toEqual([
        'KUR-RED',
        'MUG-02',
      ]);
      expect((await products('?cost=incomplete&sort=-sku')).total).toBe(2);
      expect(skus(await products('?sort=-orderCount'))).toEqual([
        'KUR-RED',
        'MUG-02',
        'SAR-GRN',
        'MUG-01',
      ]);
      expect(skus(await products('?sort=currentUnitCost'))).toEqual([
        'SAR-GRN',
        'KUR-RED',
        'MUG-01',
        'MUG-02',
      ]);
      expect(skus(await products('?sort=-currentUnitCost'))).toEqual([
        'KUR-RED',
        'SAR-GRN',
        'MUG-02',
        'MUG-01',
      ]);
      expect(skus(await products('?sort=name'))).toEqual([
        'MUG-01',
        'MUG-02',
        'KUR-RED',
        'SAR-GRN',
      ]);
      expect(skus(await products('?sort=-sku'))).toEqual([
        'SAR-GRN',
        'MUG-02',
        'MUG-01',
        'KUR-RED',
      ]);
      expect(skus(await products('?q=MUG'))).toEqual(['MUG-01', 'MUG-02']);
      expect(skus(await products('?q=saree'))).toEqual(['SAR-GRN']);
      expect(skus(await products('?q=mug-'))).toEqual([]); // SKU prefix is case-sensitive; no name has "mug-"
      const page2 = await products('?pageSize=3&page=2');
      expect([skus(page2), page2.total]).toEqual([['SAR-GRN'], 4]);
      for (const query of [
        '?sort=price',
        '?cost=maybe',
        '?status=deleted',
        '?pageSize=101',
        '?foo=1',
      ]) {
        expectError(
          await alice.get(`/accounts/${a1}/products${query}`),
          400,
          'VALIDATION_ERROR',
        );
      }
    });

    it('archive / restore (members): archived products leave the default list but keep their orders', async () => {
      const archived = ok<ProductDetail>(
        await carol.patch(`/products/${productIds['MUG-01']}`, {
          status: 'archived',
        }),
      );
      expect(archived.status).toBe('archived');
      expect(skus(await products())).toEqual(['KUR-RED', 'MUG-02', 'SAR-GRN']);
      expect(skus(await products('?status=archived'))).toEqual(['MUG-01']);
      expect((await products('?status=all')).total).toBe(4);
      expectError(
        await carol.patch(`/products/${productIds['MUG-01']}`, { sku: 'X' }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await carol.patch(`/products/${productIds['MUG-01']}`, {
          status: 'gone',
        }),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('delete a cost (owner): orders fall back to the earlier cost; audit product_cost.deleted; 403 / 404 cases', async () => {
      const kur = productIds['KUR-RED'];
      expectError(
        await carol.delete(`/products/${kur}/cost-history/${costIds.kur2}`),
        403,
        'FORBIDDEN',
      );
      // A cost entry of another product through this product's URL.
      expectError(
        await alice.delete(`/products/${kur}/cost-history/${costIds.sar}`),
        404,
        'NOT_FOUND',
      );
      const res = await alice.delete(
        `/products/${kur}/cost-history/${costIds.kur2}`,
      );
      expect(res.status).toBe(204);
      expect(await auditOf('product_cost', costIds.kur2)).toEqual([
        expect.objectContaining({ action: 'product_cost.created' }),
        expect.objectContaining({
          action: 'product_cost.deleted',
          actorUserId: Number(aliceId),
          beforeData: {
            productId: kur,
            sku: 'KUR-RED',
            effectiveFrom: '2026-10-05',
            unitCost: '600.2500',
            note: null,
          },
          afterData: null,
        }),
      ]);
      expectError(
        await alice.delete(`/products/${kur}/cost-history/${costIds.kur2}`),
        404,
        'NOT_FOUND',
      );
      const so4 = (await orderCosts()).find(([no]) => no === 'SO-4');
      // 3 × 549.5000
      expect(so4?.[2]).toEqual(KNOWN('549.5000', '2026-10-02', '1648.5000'));
      expect((await product(kur)).currentCost).toEqual({
        unitCost: '549.5000',
        effectiveFrom: '2026-10-02',
      });
    });
  });

  describe('manual products and sync for data imported before products existed', () => {
    it('A2: imported, then put back in the pre-M6 state directly in the DB (no products, no links)', async () => {
      await importOrders(
        a2,
        'legacy.csv',
        [
          ['L-1', '01-10-2026', 'DELIVERED', '1', 'P-1', 'Pen', null],
          ['L-2', '02-10-2026', 'DELIVERED', '1', 'P-1', 'Pen', null],
          ['L-3', '02-10-2026', 'DELIVERED', '1', 'P-2', 'Pencil', null],
          ['L-4', '03-10-2026', 'DELIVERED', '1', null, null, null],
          ['L-6', '04-10-2026', 'DELIVERED', '1', 'P-3', 'Eraser', null],
        ],
        '2026-10-10',
      );
      expect((await products('', a2)).total).toBe(3);
      await ctx.sequelize.query(
        'UPDATE orders SET product_id = NULL WHERE seller_account_id = ?',
        { replacements: [a2], type: QueryTypes.UPDATE },
      );
      await ctx.sequelize.query(
        'DELETE FROM products WHERE seller_account_id = ?',
        { replacements: [a2], type: QueryTypes.DELETE },
      );
      expect((await products('', a2)).total).toBe(0);
      expect((await orderCosts(a2)).map(([no, id, c]) => [no, id, c])).toEqual([
        ['L-1', null, NO_PRODUCT],
        ['L-2', null, NO_PRODUCT],
        ['L-3', null, NO_PRODUCT],
        ['L-4', null, NO_PRODUCT],
        ['L-6', null, NO_PRODUCT],
      ]);
    });

    it('manual create (member) links the existing orders with that SKU; audit product.created', async () => {
      const res = await carol.post(`/accounts/${a2}/products`, {
        sku: ' P-1 ',
        name: 'Pen (manual)',
      });
      const created = ok<ProductDetail>(res, 201);
      expect(created).toEqual({
        id: expect.any(String) as string,
        workspaceId: wsA,
        sellerAccountId: a2,
        sku: 'P-1',
        name: 'Pen (manual)',
        catalogId: null,
        status: 'active',
        orderCount: 2,
        ordersWithoutCost: 2,
        currentCost: null,
        costCount: 0,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
        costHistory: [],
      });
      expect(await auditOf('product', created.id)).toEqual([
        expect.objectContaining({
          action: 'product.created',
          afterData: {
            sku: 'P-1',
            name: 'Pen (manual)',
            catalogId: null,
            status: 'active',
            linkedOrders: 2,
          },
        }),
      ]);
      expect((await orderCosts(a2)).map(([no, id]) => [no, id])).toEqual([
        ['L-1', created.id],
        ['L-2', created.id],
        ['L-3', null],
        ['L-4', null],
        ['L-6', null],
      ]);
    });

    it('a later import with one order of an old SKU creates the product and links the OLD orders of that SKU too', async () => {
      const job = await importOrders(
        a2,
        'legacy-2.csv',
        [['L-5', '05-10-2026', 'SHIPPED', '1', 'P-2', 'Pencil HB', null]],
        '2026-10-12',
      );
      const [audit] = await auditOf('import_job', job);
      // P-2 created; L-5 (in the job) and L-3 (imported before, same SKU) linked.
      expect(audit.afterData).toEqual(
        expect.objectContaining({ createdProducts: 1, linkedOrders: 2 }),
      );
      const list = await products('', a2);
      const p2 = list.items.find((p) => p.sku === 'P-2');
      expect([p2?.name, p2?.orderCount, p2?.ordersWithoutCost]).toEqual([
        'Pencil HB',
        2,
        2,
      ]);
      expect((await orderCosts(a2)).map(([no, id]) => [no, id])).toEqual([
        ['L-1', list.items[0].id],
        ['L-2', list.items[0].id],
        ['L-3', p2?.id],
        ['L-4', null],
        ['L-5', p2?.id],
        ['L-6', null], // P-3 is in no later import: sync creates it
      ]);
      // A cost entered on P-2 reaches the old order as well (1 × 2.5000 each).
      ok(
        await alice.post(`/products/${p2?.id}/cost-history`, {
          effectiveFrom: '2026-10-01',
          unitCost: '2.5',
        }),
        201,
      );
      expect(
        (await orderCosts(a2))
          .filter(([no]) => no === 'L-3' || no === 'L-5')
          .map(([no, , c]) => [no, c]),
      ).toEqual([
        ['L-3', KNOWN('2.5000', '2026-10-01', '2.5000')],
        ['L-5', KNOWN('2.5000', '2026-10-01', '2.5000')],
      ]);
    });

    it('duplicate SKU → 409 naming sku (spacing variants included); a brand-new SKU links nothing', async () => {
      for (const sku of ['P-1', '  P-1', 'P-1​']) {
        const res = await alice.post(`/accounts/${a2}/products`, { sku });
        expectError(res, 409, 'CONFLICT');
        expect(fieldsOf(res)).toEqual(['sku']);
      }
      const fresh = ok<ProductDetail>(
        await alice.post(`/accounts/${a1}/products`, { sku: 'NEW-SKU' }),
        201,
      );
      expect([fresh.orderCount, fresh.name]).toEqual([0, null]);
      productIds['NEW-SKU'] = fresh.id;
      expectError(
        await alice.post(`/accounts/${a2}/products`, { sku: '' }),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('sync (member): creates the remaining products and links their orders; idempotent; audit only when something changed', async () => {
      expect(ok(await carol.post(`/accounts/${a2}/products/sync`, {}))).toEqual(
        { createdProducts: 1, linkedOrders: 1 },
      );
      expect(ok(await carol.post(`/accounts/${a2}/products/sync`, {}))).toEqual(
        { createdProducts: 0, linkedOrders: 0 },
      );
      expect(ok(await alice.post(`/accounts/${a1}/products/sync`, {}))).toEqual(
        {
          createdProducts: 0,
          linkedOrders: 0,
        },
      );
      const synced = await auditOf('seller_account', a2);
      expect(synced.filter((r) => r.action === 'products.synced')).toEqual([
        expect.objectContaining({
          afterData: { createdProducts: 1, linkedOrders: 1 },
        }),
      ]);
      const list = await products('', a2);
      expect(list.items.map((p) => [p.sku, p.name, p.orderCount])).toEqual([
        ['P-1', 'Pen (manual)', 2],
        ['P-2', 'Pencil HB', 2],
        ['P-3', 'Eraser', 1],
      ]);
      expect((await orderCosts(a2)).map(([, id]) => id === null)).toEqual([
        false,
        false,
        false,
        true, // L-4: no SKU
        false,
        false,
      ]);
    });
  });

  describe('expenses', () => {
    it('categories: the allowlist with labels and help; only "other" needs a description', async () => {
      const body = ok<{
        items: {
          key: string;
          label: string;
          help: string;
          descriptionRequired: boolean;
        }[];
      }>(await carol.get('/expenses/categories'));
      expect(body.items.map((c) => c.key)).toEqual([
        'packaging',
        'own_shipping',
        'warehousing',
        'staff',
        'rent_utilities',
        'software_tools',
        'external_marketing',
        'professional_fees',
        'bank_charges',
        'other',
      ]);
      expect(body.items[0]).toEqual({
        key: 'packaging',
        label: 'Packaging & labels',
        help: expect.any(String) as string,
        descriptionRequired: false,
      });
      expect(
        body.items.filter((c) => c.descriptionRequired).map((c) => c.key),
      ).toEqual(['other']);
    });

    it('owner creates account and workspace expenses → 201 Expense (amount 2 decimals, scope fixed by the route); audit', async () => {
      const create = async (path: string, label: string, body: object) => {
        const expense = ok<Expense>(await alice.post(path, body), 201);
        expenseIds[label] = expense.id;
        return expense;
      };
      const e1 = await create(`/accounts/${a1}/expenses`, 'E1', {
        expenseDate: '2026-10-05',
        category: 'packaging',
        description: ' Boxes ',
        amount: '1200.5',
      });
      expect(e1).toEqual({
        id: expect.any(String) as string,
        workspaceId: wsA,
        sellerAccountId: a1,
        scope: 'account',
        expenseDate: '2026-10-05',
        category: 'packaging',
        categoryLabel: 'Packaging & labels',
        description: 'Boxes',
        amount: '1200.50',
        createdBy: { id: aliceId, displayName: 'alice', email: email('alice') },
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      const e2 = await create(`/accounts/${a1}/expenses`, 'E2', {
        expenseDate: '2026-10-10',
        category: 'staff',
        amount: 15000,
      });
      expect([e2.amount, e2.description]).toEqual(['15000.00', null]);
      await create(`/accounts/${a1}/expenses`, 'E3', {
        expenseDate: '2026-10-20',
        category: 'other',
        description: 'Stall fee',
        amount: '99.99',
      });
      await create(`/accounts/${a2}/expenses`, 'E4', {
        expenseDate: '2026-10-08',
        category: 'packaging',
        amount: '300',
      });
      const w1 = await create(`/workspaces/${wsA}/expenses`, 'W1', {
        expenseDate: '2026-10-01',
        category: 'rent_utilities',
        description: 'Office rent',
        amount: '25000.00',
      });
      expect([w1.scope, w1.sellerAccountId, w1.workspaceId]).toEqual([
        'workspace',
        null,
        wsA,
      ]);
      const w2 = await create(`/workspaces/${wsA}/expenses`, 'W2', {
        expenseDate: '2026-10-15',
        category: 'software_tools',
        amount: '499.5',
      });
      expect(w2.amount).toBe('499.50');
      expect(await auditOf('expense', e1.id)).toEqual([
        {
          action: 'expense.created',
          actorUserId: Number(aliceId),
          workspaceId: Number(wsA),
          sellerAccountId: Number(a1),
          beforeData: null,
          afterData: {
            scope: 'account',
            expenseDate: '2026-10-05',
            category: 'packaging',
            description: 'Boxes',
            amount: '1200.50',
          },
        },
      ]);
      expect((await auditOf('expense', w1.id))[0]).toEqual(
        expect.objectContaining({
          workspaceId: Number(wsA),
          sellerAccountId: null,
        }),
      );
    });

    it('lists with SQL DECIMAL totals over every filtered row (hand-checked), filters and sorts; members read', async () => {
      const acc = await expenses(`/accounts/${a1}/expenses`);
      expect([labelsOf(acc), acc.total, acc.totals]).toEqual([
        ['E3', 'E2', 'E1'],
        3,
        // 1200.50 + 15000.00 + 99.99
        { amount: '16300.49', count: 3 },
      ]);
      const byCategory = await expenses(
        `/accounts/${a1}/expenses?category=packaging&category=other`,
      );
      expect([labelsOf(byCategory), byCategory.totals]).toEqual([
        ['E3', 'E1'],
        { amount: '1300.49', count: 2 },
      ]);
      const byDate = await expenses(
        `/accounts/${a1}/expenses?from=2026-10-06&to=2026-10-31`,
      );
      expect([labelsOf(byDate), byDate.totals]).toEqual([
        ['E3', 'E2'],
        { amount: '15099.99', count: 2 },
      ]);
      expect(
        labelsOf(await expenses(`/accounts/${a1}/expenses?sort=amount`)),
      ).toEqual(['E3', 'E1', 'E2']);
      // Totals cover all filtered rows, not just the page.
      const paged = await expenses(
        `/accounts/${a1}/expenses?pageSize=1&page=2`,
      );
      expect([labelsOf(paged), paged.total, paged.totals.amount]).toEqual([
        ['E2'],
        3,
        '16300.49',
      ]);
      const none = await expenses(
        `/accounts/${a1}/expenses?category=bank_charges`,
      );
      expect([none.items, none.total, none.totals]).toEqual([
        [],
        0,
        { amount: null, count: 0 },
      ]);
      const ws = await expenses(`/workspaces/${wsA}/expenses`);
      expect([labelsOf(ws), ws.totals]).toEqual([
        ['W2', 'W1'],
        // 25000.00 + 499.50
        { amount: '25499.50', count: 2 },
      ]);
      const all = await expenses(
        `/workspaces/${wsA}/expenses?scope=all`,
        carol,
      );
      expect([labelsOf(all), all.totals]).toEqual([
        ['E3', 'W2', 'E2', 'E4', 'E1', 'W1'],
        // 25499.50 + 16300.49 + 300.00
        { amount: '42099.99', count: 6 },
      ]);
      const allPackaging = await expenses(
        `/workspaces/${wsA}/expenses?scope=all&category=packaging`,
      );
      expect([labelsOf(allPackaging), allPackaging.totals]).toEqual([
        ['E4', 'E1'],
        { amount: '1500.50', count: 2 },
      ]);
      // sort=category follows the labels: Other, Packaging & labels (×2, by id), Rent & utilities,
      // Salaries & staff, Software & tools (by key, software_tools would come before staff).
      expect(
        labelsOf(
          await expenses(`/workspaces/${wsA}/expenses?scope=all&sort=category`),
        ),
      ).toEqual(['E3', 'E1', 'E4', 'W1', 'E2', 'W2']);
      expect(
        labelsOf(
          await expenses(
            `/workspaces/${wsA}/expenses?scope=all&sort=-category`,
          ),
        ),
      ).toEqual(['W2', 'E2', 'W1', 'E4', 'E1', 'E3']);
      for (const query of [
        '?sort=description',
        '?category=ads',
        '?from=2026-10-10&to=2026-10-01',
        '?scope=all',
      ]) {
        expectError(
          await alice.get(`/accounts/${a1}/expenses${query}`),
          400,
          'VALIDATION_ERROR',
        );
      }
      expectError(
        await alice.get(`/workspaces/${wsA}/expenses?scope=account`),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('validation → 400 naming the field: future date, "other" without description, amount rules, unknown category or fields', async () => {
      const url = `/accounts/${a1}/expenses`;
      const base = {
        expenseDate: '2026-10-05',
        category: 'staff',
        amount: '10',
      };
      for (const [body, field] of [
        [{ ...base, expenseDate: addDays(today, 1) }, 'expenseDate'],
        [{ ...base, category: 'other' }, 'description'],
        [{ ...base, category: 'other', description: '   ' }, 'description'],
        // only a zero-width space: no visible text
        [{ ...base, category: 'other', description: '​' }, 'description'],
        [{ ...base, amount: '0' }, 'amount'],
        [{ ...base, amount: '-5' }, 'amount'],
        [{ ...base, amount: '10.123' }, 'amount'],
        [{ ...base, amount: '10000000000' }, 'amount'],
        [{ ...base, category: 'meesho_ads' }, 'category'],
        [{ ...base, scope: 'workspace' }, 'scope'],
        [{ ...base, sellerAccountId: a2 }, 'sellerAccountId'],
      ] as const) {
        const res = await alice.post(url, body);
        expectError(res, 400, 'VALIDATION_ERROR');
        expect({ body, fields: fieldsOf(res) }).toEqual({
          body,
          fields: [field],
        });
      }
      // Today (India) is allowed.
      const todays = ok<Expense>(
        await alice.post(url, { ...base, expenseDate: today }),
        201,
      );
      expect((await alice.delete(`/expenses/${todays.id}`)).status).toBe(204);
    });

    it('members cannot create, edit or delete (403)', async () => {
      const body = {
        expenseDate: '2026-10-05',
        category: 'staff',
        amount: '10',
      };
      expectError(
        await carol.post(`/accounts/${a1}/expenses`, body),
        403,
        'FORBIDDEN',
      );
      expectError(
        await carol.post(`/workspaces/${wsA}/expenses`, body),
        403,
        'FORBIDDEN',
      );
      expectError(
        await carol.patch(`/expenses/${expenseIds.E1}`, { amount: '1' }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await carol.delete(`/expenses/${expenseIds.E1}`),
        403,
        'FORBIDDEN',
      );
    });

    it('edit (owner): changed fields audited; no change → no audit; "other" still needs a description; scope immutable', async () => {
      const e1 = ok<Expense>(
        await alice.patch(`/expenses/${expenseIds.E1}`, { amount: '1300.5' }),
      );
      expect([e1.amount, e1.scope, e1.sellerAccountId]).toEqual([
        '1300.50',
        'account',
        a1,
      ]);
      expect(
        ok<Expense>(
          await alice.patch(`/expenses/${expenseIds.E1}`, { amount: 1300.5 }),
        ).amount,
      ).toBe('1300.50');
      expect(
        (await auditOf('expense', expenseIds.E1)).map((r) => [
          r.action,
          r.beforeData,
          r.afterData,
        ]),
      ).toEqual([
        ['expense.created', null, expect.any(Object)],
        ['expense.updated', { amount: '1200.50' }, { amount: '1300.50' }],
      ]);
      const toOther = await alice.patch(`/expenses/${expenseIds.E2}`, {
        category: 'other',
      });
      expectError(toOther, 400, 'VALIDATION_ERROR');
      expect(fieldsOf(toOther)).toEqual(['description']);
      const fixed = ok<Expense>(
        await alice.patch(`/expenses/${expenseIds.E2}`, {
          category: 'other',
          description: 'Diwali bonus',
        }),
      );
      expect([fixed.category, fixed.categoryLabel, fixed.description]).toEqual([
        'other',
        'Other (description required)',
        'Diwali bonus',
      ]);
      expect(
        fieldsOf(
          await alice.patch(`/expenses/${expenseIds.E3}`, {
            description: null,
          }),
        ),
      ).toEqual(['description']);
      for (const body of [
        { scope: 'workspace' },
        { sellerAccountId: a2 },
        { workspaceId: wsB },
      ]) {
        expectError(
          await alice.patch(`/expenses/${expenseIds.W1}`, body),
          400,
          'VALIDATION_ERROR',
        );
      }
      expectError(
        await alice.patch(`/expenses/${expenseIds.E1}`, {
          expenseDate: addDays(today, 1),
        }),
        400,
        'VALIDATION_ERROR',
      );
      const totals = (await expenses(`/accounts/${a1}/expenses`)).totals;
      // 1300.50 + 15000.00 + 99.99
      expect(totals).toEqual({ amount: '16400.49', count: 3 });
    });

    it('delete (owner) → 204; audit expense.deleted with the row before; a second delete → 404', async () => {
      expect((await alice.delete(`/expenses/${expenseIds.E3}`)).status).toBe(
        204,
      );
      expect((await auditOf('expense', expenseIds.E3)).at(-1)).toEqual(
        expect.objectContaining({
          action: 'expense.deleted',
          beforeData: {
            scope: 'account',
            expenseDate: '2026-10-20',
            category: 'other',
            description: 'Stall fee',
            amount: '99.99',
          },
          afterData: null,
        }),
      );
      const acc = await expenses(`/accounts/${a1}/expenses`);
      expect([labelsOf(acc), acc.totals]).toEqual([
        ['E2', 'E1'],
        { amount: '16300.50', count: 2 },
      ]);
      expectError(
        await alice.delete(`/expenses/${expenseIds.E3}`),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('tenancy: every new route is 404 for a stranger; ids of another tenant are 404', () => {
    let bobProduct: string;
    let bobCost: string;
    let bobExpense: string;

    beforeAll(async () => {
      bobProduct = ok<ProductDetail>(
        await bob.post(`/accounts/${b1}/products`, { sku: 'B-1' }),
        201,
      ).id;
      bobCost = ok<CostEntry>(
        await bob.post(`/products/${bobProduct}/cost-history`, {
          effectiveFrom: '2026-10-01',
          unitCost: '5',
        }),
        201,
      ).id;
      bobExpense = ok<Expense>(
        await bob.post(`/workspaces/${wsB}/expenses`, {
          expenseDate: '2026-10-01',
          category: 'staff',
          amount: '5',
        }),
        201,
      ).id;
    });

    it('Bob gets 404 on every product / cost / expense route of workspace A', async () => {
      const kur = productIds['KUR-RED'];
      const attempts: [string, () => Promise<Response>][] = [
        ['list products', () => bob.get(`/accounts/${a1}/products`)],
        [
          'create product',
          () => bob.post(`/accounts/${a1}/products`, { sku: 'Z' }),
        ],
        ['sync', () => bob.post(`/accounts/${a1}/products/sync`, {})],
        ['product detail', () => bob.get(`/products/${kur}`)],
        ['edit product', () => bob.patch(`/products/${kur}`, { name: 'x' })],
        [
          'add cost',
          () =>
            bob.post(`/products/${kur}/cost-history`, {
              effectiveFrom: '2026-10-01',
              unitCost: '1',
            }),
        ],
        [
          'delete cost',
          () => bob.delete(`/products/${kur}/cost-history/${costIds.kur1}`),
        ],
        ['account expenses', () => bob.get(`/accounts/${a1}/expenses`)],
        [
          'create account expense',
          () =>
            bob.post(`/accounts/${a1}/expenses`, {
              expenseDate: '2026-10-01',
              category: 'staff',
              amount: '1',
            }),
        ],
        [
          'workspace expenses',
          () => bob.get(`/workspaces/${wsA}/expenses?scope=all`),
        ],
        [
          'create workspace expense',
          () =>
            bob.post(`/workspaces/${wsA}/expenses`, {
              expenseDate: '2026-10-01',
              category: 'staff',
              amount: '1',
            }),
        ],
        [
          'edit expense',
          () => bob.patch(`/expenses/${expenseIds.E1}`, { amount: '1' }),
        ],
        ['delete expense', () => bob.delete(`/expenses/${expenseIds.W1}`)],
      ];
      for (const [label, attempt] of attempts) {
        const res = await attempt();
        expect({
          label,
          status: res.status,
          code: (res.body as ErrorBody).error?.code,
        }).toEqual({
          label,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      // Nothing changed.
      expect((await product(kur)).name).toBe('Red Kurti');
      expect((await expenses(`/accounts/${a1}/expenses`)).totals.amount).toBe(
        '16300.50',
      );
    });

    it("Alice (owner of A) gets 404 for Bob's product, cost and expense ids", async () => {
      const kur = productIds['KUR-RED'];
      const attempts: [string, () => Promise<Response>][] = [
        ['product detail', () => alice.get(`/products/${bobProduct}`)],
        [
          'edit product',
          () => alice.patch(`/products/${bobProduct}`, { name: 'x' }),
        ],
        [
          'add cost',
          () =>
            alice.post(`/products/${bobProduct}/cost-history`, {
              effectiveFrom: '2026-10-02',
              unitCost: '1',
            }),
        ],
        [
          'delete cost',
          () => alice.delete(`/products/${bobProduct}/cost-history/${bobCost}`),
        ],
        [
          "Bob's cost through Alice's product",
          () => alice.delete(`/products/${kur}/cost-history/${bobCost}`),
        ],
        [
          'edit expense',
          () => alice.patch(`/expenses/${bobExpense}`, { amount: '1' }),
        ],
        ['delete expense', () => alice.delete(`/expenses/${bobExpense}`)],
        [
          'other workspace list',
          () => alice.get(`/workspaces/${wsB}/expenses`),
        ],
        ['other account products', () => alice.get(`/accounts/${b1}/products`)],
      ];
      for (const [label, attempt] of attempts) {
        const res = await attempt();
        expect({ label, status: res.status }).toEqual({ label, status: 404 });
      }
      expect(
        ok<ProductDetail>(await bob.get(`/products/${bobProduct}`)).costCount,
      ).toBe(1);
    });
  });

  describe('a disabled account is read-only for products, costs and its expenses', () => {
    it('409 on product / cost / account-expense writes; reads still work', async () => {
      expect((await alice.delete(`/accounts/${a2}`)).status).toBe(200);
      const p1 = (await products('', a2)).items[0].id;
      for (const res of [
        await alice.post(`/accounts/${a2}/products`, { sku: 'P-9' }),
        await alice.post(`/accounts/${a2}/products/sync`, {}),
        await alice.patch(`/products/${p1}`, { name: 'x' }),
        await alice.post(`/products/${p1}/cost-history`, {
          effectiveFrom: '2026-10-01',
          unitCost: '1',
        }),
        await alice.post(`/accounts/${a2}/expenses`, {
          expenseDate: '2026-10-01',
          category: 'staff',
          amount: '1',
        }),
        await alice.patch(`/expenses/${expenseIds.E4}`, { amount: '1' }),
        await alice.delete(`/expenses/${expenseIds.E4}`),
      ]) {
        expectError(res, 409, 'CONFLICT');
      }
      expect((await products('', a2)).total).toBe(3);
      expect((await expenses(`/accounts/${a2}/expenses`)).totals.amount).toBe(
        '300.00',
      );
      // Workspace-wide expenses are not tied to the account.
      expect(
        ok<Expense>(
          await alice.patch(`/expenses/${expenseIds.W2}`, { amount: '500' }),
        ).amount,
      ).toBe('500.00');
    });
  });

  it('Swagger documents the new routes', async () => {
    const res = await request(ctx.server).get('/api/docs-json').expect(200);
    const paths = Object.keys(
      (res.body as { paths: Record<string, unknown> }).paths,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/accounts/{accountId}/products',
        '/api/v1/accounts/{accountId}/products/sync',
        '/api/v1/products/{productId}',
        '/api/v1/products/{productId}/cost-history',
        '/api/v1/products/{productId}/cost-history/{costId}',
        '/api/v1/expenses/categories',
        '/api/v1/accounts/{accountId}/expenses',
        '/api/v1/workspaces/{workspaceId}/expenses',
        '/api/v1/expenses/{expenseId}',
      ]),
    );
  });
});
