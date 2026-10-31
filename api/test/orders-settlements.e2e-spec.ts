import { QueryTypes } from 'sequelize';
import type { Response } from 'supertest';
import { WorkspaceAccessService } from '../src/authorization/workspace-access.service';
import {
  ReconciliationRun,
  SettlementEntry,
  WorkspaceMember,
} from '../src/database/models';
import {
  ACCOUNT_BUSY_MESSAGE,
  RUN_ACCOUNT_DISABLED_MESSAGE,
  RUN_FAILED_MESSAGE,
} from '../src/reconciliation/reconciliation.service';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
  TEST_CLIENT_IP_HEADER,
} from './support/e2e-app';
import { csv, workbook, type Cell } from './support/import-fixtures';
import { type ErrorBody, TestClient } from './support/test-client';

const PASSWORD = 'correct horse battery';

interface ImportRef {
  id: string;
  originalFilename: string;
  createdAt: string;
}

interface UserRef {
  id: string;
  displayName: string | null;
  email: string;
}

interface OrderSummary {
  id: string;
  subOrderNo: string;
  orderNo: string | null;
  orderDate: string;
  productName: string | null;
  sku: string | null;
  size: string | null;
  quantity: number;
  customerState: string | null;
  supplierListedPrice: string | null;
  supplierDiscountedPrice: string | null;
  currentStatus: string;
  currentStatusObservedAt: string;
  settlement: { entryCount: number; amount: string | null };
}

interface StatusEvent {
  id: string;
  status: string;
  observedAt: string;
  importJob: ImportRef;
}

interface Entry {
  id: string;
  entryType: string;
  sheetName: string;
  transactionId: string | null;
  subOrderNo: string | null;
  orderDate: string | null;
  paymentDate: string | null;
  settlementAmount: string;
  saleAmount: string | null;
  returnAmount: string | null;
  commissionAmount: string | null;
  shippingCharge: string | null;
  tcsAmount: string | null;
  tdsAmount: string | null;
  recoveryAmount: string | null;
  compensationAmount: string | null;
  isEstimate: boolean;
  supersededByEntryId: string | null;
  importJob: ImportRef;
  createdAt: string;
  match: {
    state: string;
    method: string | null;
    orderId: string | null;
    orderSubOrderNo: string | null;
    matchedAt: string | null;
    matchedBy: UserRef | null;
    autoMatchBlocked: boolean;
  };
}

interface OrderDetail extends OrderSummary {
  catalogId: string | null;
  packetId: string | null;
  createdAt: string;
  updatedAt: string;
  firstImport: ImportRef;
  lastImport: ImportRef;
  statusHistory: StatusEvent[];
  settlements: Entry[];
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface SettlementPage extends Page<Entry> {
  totals: { settlementAmount: string | null; count: number };
}

interface Run {
  id: string;
  triggerType: string;
  status: string;
  importJobId: string | null;
  triggeredBy: UserRef | null;
  startedAt: string;
  finishedAt: string | null;
  matchedCount: number | null;
  unmatchedSettlementCount: number | null;
  unmatchedOrderCount: number | null;
  failureMessage: string | null;
}

interface Overview {
  lastRun: Run | null;
  settlements: {
    total: number;
    matched: number;
    unmatched: number;
    accountLevel: number;
    matchedAmount: string | null;
    unmatchedAmount: string | null;
    accountLevelAmount: string | null;
  };
  orders: { total: number; withSettlement: number; withoutSettlement: number };
  withoutSettlementByStatus: { status: string; count: number }[];
}

interface AuditRow {
  action: string;
  actorUserId: number;
  sellerAccountId: number;
  beforeData: unknown;
  afterData: unknown;
}

/** dataAsOf D means the end of day D in India: 23:59:59.999 IST. */
const endOfDayIst = (date: string) =>
  new Date(`${date}T23:59:59.999+05:30`).toISOString();

const ORDER_HEADER = [
  'Sub Order No',
  'Order Date',
  'Reason for Credit Entry',
  'Quantity',
  'SKU',
  'Product Name',
  'Supplier Listed Price (Incl. GST + Commission)',
  'Supplier Discounted Price (Incl GST and Commission)',
  'Customer State',
];
const MINIMAL_ORDER_HEADER = [
  'Sub Order No',
  'Order Date',
  'Reason for Credit Entry',
  'Quantity',
];
const PAYMENT_HEADER = [
  'Sub Order No',
  'Transaction ID',
  'Order Date',
  'Payment Date',
  'Final Settlement Amount',
  'Total Sale Amount (Incl. Shipping & GST)',
  'Meesho Commission (Incl. GST)',
  'TCS',
  'TDS',
];

/**
 * Orders, settlements and reconciliation (Milestone 5) against meesho_test, with every row created through
 * the real import endpoints. Hand-checked fixture:
 *
 * Account "Shop" (A1, workspace A, owner Alice; Carol is a member of A):
 *   orders-1.csv (as of 10 Oct): SO-101 DELIVERED, SO-102 SHIPPED, SO-103 DELIVERED, SO-104 RTO, SO-105 Delivered
 *   payments workbook (e1–e7, in file order):
 *     e1 SO-101 TXN-9  08-10  420.15 | e2 SO-102 TXN-9 08-10 210.40 | e3 = e2 repeated (same transaction ID)
 *     e4 SO-102 TXN-10 15-10  -20.00 | e5 SO-999 TXN-11 15-10 75.25 (no such order)
 *     e6 Ads Cost CMP-1 09-10 -150.50 | e7 Referral 12-10 30.00 (account level: no sub order)
 *   orders-2.csv (as of 15 Oct): SO-102 DELIVERED; orders-0.csv (as of 5 Oct): SO-102 PENDING (history only)
 * Sums: all 775.70; matched (e1–e4) 820.95; unmatched (e5) 75.25; account level (e6, e7) −120.50;
 *       TXN-9 (e1–e3) 840.95; SO-102 (e2–e4) 400.80.
 * Account "Second" (A2, workspace A): settlement workbook first (SO-201 ×2, SO-202), then orders (SO-201).
 * Bob owns workspace B and is a stranger to A.
 */
describe('orders, settlements and reconciliation (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;

  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  let aliceId: string;
  let carolId: string;
  let wsA: string;
  let a1: string;
  let a2: string;
  let ipSeq = 0;

  const jobs: Record<string, string> = {};
  /** Order ids of A1 by sub order no, and of A2. */
  const orderIds: Record<string, string> = {};
  /** e1..e7 of A1 and the A2 entries, in id order. */
  let e: string[] = [];
  let a2Entries: string[] = [];

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

  async function createAccount(name: string): Promise<string> {
    const res = await alice.post(`/workspaces/${wsA}/accounts`, {
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

  /** Upload (fresh client IP: the per-IP upload throttle) + confirm → completed; returns the job id. */
  async function importFile(
    client: TestClient,
    accountId: string,
    name: string,
    content: Buffer | string,
    dataAsOf?: string,
  ): Promise<string> {
    ipSeq += 1;
    const uploaded = await client.upload(
      `/accounts/${accountId}/imports`,
      { name, content },
      dataAsOf ? { dataAsOf } : {},
      { headers: { [TEST_CLIENT_IP_HEADER]: `10.88.0.${ipSeq}` } },
    );
    expect({
      status: uploaded.status,
      body: uploaded.status === 201 ? null : (uploaded.body as unknown),
    }).toEqual({
      status: 201,
      body: null,
    });
    const id = (uploaded.body as { id: string }).id;
    const confirmed = await client.post(`/imports/${id}/confirm`, {});
    expect({
      status: confirmed.status,
      jobStatus: (confirmed.body as { status: string }).status,
    }).toEqual({ status: 200, jobStatus: 'completed' });
    return id;
  }

  async function runsOf(accountId: string): Promise<Run[]> {
    const res = await alice.get(`/accounts/${accountId}/reconciliation/runs`);
    expect(res.status).toBe(200);
    return (res.body as Page<Run>).items;
  }

  async function orders(
    query = '',
    accountId = a1,
  ): Promise<Page<OrderSummary>> {
    const res = await alice.get(`/accounts/${accountId}/orders${query}`);
    expect({
      status: res.status,
      body: res.status === 200 ? null : (res.body as unknown),
    }).toEqual({
      status: 200,
      body: null,
    });
    return res.body as Page<OrderSummary>;
  }

  const subOrders = (page: Page<OrderSummary>) =>
    page.items.map((o) => o.subOrderNo);

  async function settlements(query = ''): Promise<SettlementPage> {
    const res = await alice.get(`/accounts/${a1}/settlements${query}`);
    expect({
      status: res.status,
      body: res.status === 200 ? null : (res.body as unknown),
    }).toEqual({
      status: 200,
      body: null,
    });
    return res.body as SettlementPage;
  }

  /** Entry labels (e1..e7) of a page, in page order. */
  const labels = (page: Page<Entry>) =>
    page.items.map((item) => `e${e.indexOf(item.id) + 1}`);

  async function overview(): Promise<Overview> {
    const res = await alice.get(`/accounts/${a1}/reconciliation`);
    expect(res.status).toBe(200);
    return res.body as Overview;
  }

  async function auditOf(entryId: string): Promise<AuditRow[]> {
    return ctx.sequelize.query<AuditRow>(
      `SELECT action, actor_user_id AS actorUserId, seller_account_id AS sellerAccountId,
              before_data AS beforeData, after_data AS afterData
       FROM audit_logs WHERE entity_type = 'settlement_entry' AND entity_id = ? ORDER BY id`,
      { replacements: [entryId], type: QueryTypes.SELECT },
    );
  }

  const match = (
    client: TestClient,
    settlementEntryId: string,
    orderId: string,
    accountId = a1,
  ) =>
    client.post(`/accounts/${accountId}/reconciliation/manual-match`, {
      settlementEntryId,
      orderId,
    });

  const unmatch = (
    client: TestClient,
    settlementEntryId: string,
    accountId = a1,
  ) =>
    client.post(`/accounts/${accountId}/reconciliation/manual-unmatch`, {
      settlementEntryId,
    });

  beforeAll(async () => {
    ctx = await createE2eApp();
    const a = await register('alice', 'Domain A');
    const b = await register('bob', 'Domain B');
    const c = await register('carol', 'Carol own');
    alice = a.client;
    bob = b.client;
    carol = c.client;
    aliceId = a.me.user.id;
    carolId = c.me.user.id;
    wsA = a.me.workspaces[0].id;
    await WorkspaceMember.create({
      workspaceId: Number(wsA),
      userId: Number(carolId),
      role: 'member',
    });
    a1 = await createAccount('Shop');
    a2 = await createAccount('Second');
  }, 60_000);

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  describe('every completed import runs the matcher in its transaction (trigger "import")', () => {
    it('A1: orders first → run with nothing to match (0 / 0 / 5 orders without settlement)', async () => {
      const rows: Cell[][] = [
        ORDER_HEADER,
        [
          'SO-101',
          '01-10-2026',
          'DELIVERED',
          '1',
          'KUR-RED-M',
          'Red Kurti 100% cotton',
          '499',
          '449',
          'Gujarat',
        ],
        [
          'SO-102',
          '02-10-2026',
          'SHIPPED',
          '2',
          'KUR-BLU-L',
          'Blue_Kurti',
          '250.5',
          '230',
          'Maharashtra',
        ],
        [
          'SO-103',
          '03-10-2026',
          'DELIVERED',
          '1',
          'SAR-GRN',
          'Green Saree',
          '999',
          '899',
          'Gujarat',
        ],
        [
          'SO-104',
          '04-10-2026',
          'RTO',
          '1',
          'KUR-RED-L',
          'Red Kurti',
          '499',
          '449',
          'Delhi',
        ],
        [
          'SO-105',
          '05-10-2026',
          'Delivered',
          '1',
          'KUR%-X',
          'Percent Kurti',
          '100',
          '90',
          'Kerala',
        ],
      ];
      jobs.orders1 = await importFile(
        alice,
        a1,
        'orders-1.csv',
        csv(rows),
        '2026-10-10',
      );
      const [run] = await runsOf(a1);
      expect(run).toEqual({
        id: expect.any(String) as string,
        triggerType: 'import',
        status: 'completed',
        importJobId: jobs.orders1,
        triggeredBy: {
          id: aliceId,
          displayName: 'alice',
          email: email('alice'),
        },
        startedAt: expect.any(String) as string,
        finishedAt: expect.any(String) as string,
        matchedCount: 0,
        unmatchedSettlementCount: 0,
        unmatchedOrderCount: 5,
        failureMessage: null,
      });
      const list = await orders('?sort=subOrderNo');
      for (const o of list.items) orderIds[o.subOrderNo] = o.id;
      expect(Object.keys(orderIds)).toEqual([
        'SO-101',
        'SO-102',
        'SO-103',
        'SO-104',
        'SO-105',
      ]);
    });

    it('A1: the settlement workbook after the orders → matches e1–e4 (repeated transaction IDs separately); SO-999 stays unmatched', async () => {
      const file = await workbook([
        {
          name: 'Order Payments',
          rows: [
            PAYMENT_HEADER,
            [
              'SO-101',
              'TXN-9',
              '01-10-2026',
              '08-10-2026',
              420.15,
              499,
              -60,
              -4.23,
              -14.62,
            ],
            [
              'SO-102',
              'TXN-9',
              '02-10-2026',
              '08-10-2026',
              210.4,
              250.5,
              -40.1,
              null,
              null,
            ],
            [
              'SO-102',
              'TXN-9',
              '02-10-2026',
              '08-10-2026',
              210.4,
              250.5,
              -40.1,
              null,
              null,
            ],
            [
              'SO-102',
              'TXN-10',
              '02-10-2026',
              '15-10-2026',
              -20,
              null,
              null,
              null,
              null,
            ],
            [
              'SO-999',
              'TXN-11',
              '06-10-2026',
              '15-10-2026',
              75.25,
              null,
              null,
              null,
              null,
            ],
          ],
        },
        {
          name: 'Ads Cost',
          rows: [
            ['Campaign ID', 'Deduction Date', 'Total Ads Cost'],
            ['CMP-1', '09-10-2026', -150.5],
          ],
        },
        {
          name: 'Referral Payments',
          rows: [
            ['Payment Date', 'Net Referral Amount'],
            ['12-10-2026', 30],
          ],
        },
      ]);
      jobs.payments = await importFile(carol, a1, 'payments-a1.xlsx', file);
      const [run] = await runsOf(a1);
      expect(run).toEqual(
        expect.objectContaining({
          triggerType: 'import',
          importJobId: jobs.payments,
          triggeredBy: {
            id: carolId,
            displayName: 'carol',
            email: email('carol'),
          },
          matchedCount: 4,
          unmatchedSettlementCount: 1,
          unmatchedOrderCount: 3,
        }),
      );
      const entries = await SettlementEntry.findAll({
        where: { sellerAccountId: Number(a1) },
        order: [['id', 'ASC']],
      });
      e = entries.map((x) => String(x.id));
      expect(
        entries.map((x) => [
          x.subOrderNo,
          x.orderId === null ? null : String(x.orderId),
          x.matchMethod,
        ]),
      ).toEqual([
        ['SO-101', orderIds['SO-101'], 'auto'],
        ['SO-102', orderIds['SO-102'], 'auto'],
        ['SO-102', orderIds['SO-102'], 'auto'],
        ['SO-102', orderIds['SO-102'], 'auto'],
        ['SO-999', null, null],
        [null, null, null],
        [null, null, null],
      ]);
    });

    it('A1: a newer and an older orders file (SO-102) record runs too; nothing new to match', async () => {
      jobs.orders2 = await importFile(
        alice,
        a1,
        'orders-2.csv',
        csv([MINIMAL_ORDER_HEADER, ['SO-102', '02-10-2026', 'DELIVERED', '2']]),
        '2026-10-15',
      );
      jobs.orders0 = await importFile(
        alice,
        a1,
        'orders-0.csv',
        csv([MINIMAL_ORDER_HEADER, ['SO-102', '02-10-2026', 'PENDING', '2']]),
        '2026-10-05',
      );
      const runs = await runsOf(a1);
      expect(
        runs.map((r) => [
          r.importJobId,
          r.matchedCount,
          r.unmatchedSettlementCount,
          r.unmatchedOrderCount,
        ]),
      ).toEqual([
        [jobs.orders0, 0, 1, 3],
        [jobs.orders2, 0, 1, 3],
        [jobs.payments, 4, 1, 3],
        [jobs.orders1, 0, 0, 5],
      ]);
    });

    it('A2: settlements first (nothing to match), then the orders import matches the waiting entries', async () => {
      const file = await workbook([
        {
          name: 'Order Payments',
          rows: [
            PAYMENT_HEADER,
            [
              'SO-201',
              'TXN-21',
              '01-10-2026',
              '10-10-2026',
              50,
              null,
              null,
              null,
              null,
            ],
            [
              'SO-201',
              'TXN-22',
              '01-10-2026',
              '11-10-2026',
              25,
              null,
              null,
              null,
              null,
            ],
            [
              'SO-202',
              'TXN-23',
              '02-10-2026',
              '11-10-2026',
              10,
              null,
              null,
              null,
              null,
            ],
          ],
        },
      ]);
      jobs.a2payments = await importFile(alice, a2, 'payments-a2.xlsx', file);
      expect((await runsOf(a2))[0]).toEqual(
        expect.objectContaining({
          importJobId: jobs.a2payments,
          matchedCount: 0,
          unmatchedSettlementCount: 3,
          unmatchedOrderCount: 0,
        }),
      );
      jobs.a2orders = await importFile(
        alice,
        a2,
        'orders-a2.csv',
        csv([MINIMAL_ORDER_HEADER, ['SO-201', '01-10-2026', 'DELIVERED', '1']]),
        '2026-10-12',
      );
      expect((await runsOf(a2))[0]).toEqual(
        expect.objectContaining({
          importJobId: jobs.a2orders,
          matchedCount: 2,
          unmatchedSettlementCount: 1,
          unmatchedOrderCount: 0,
        }),
      );
      const a2Orders = await orders('', a2);
      orderIds['SO-201'] = a2Orders.items[0].id;
      expect(a2Orders.items[0].settlement).toEqual({
        entryCount: 2,
        amount: '75.00',
      });
      a2Entries = (
        await SettlementEntry.findAll({
          where: { sellerAccountId: Number(a2) },
          order: [['id', 'ASC']],
        })
      ).map((x) => String(x.id));
      expect(a2Entries).toHaveLength(3);
    });
  });

  describe('orders', () => {
    it('list: defaults (page 1, 25 per page, newest order date first) with as-reported settlement summaries', async () => {
      const list = await orders();
      expect([list.page, list.pageSize, list.total]).toEqual([1, 25, 5]);
      expect(subOrders(list)).toEqual([
        'SO-105',
        'SO-104',
        'SO-103',
        'SO-102',
        'SO-101',
      ]);
      expect(list.items.map((o) => [o.subOrderNo, o.settlement])).toEqual([
        ['SO-105', { entryCount: 0, amount: null }],
        ['SO-104', { entryCount: 0, amount: null }],
        ['SO-103', { entryCount: 0, amount: null }],
        // 210.40 + 210.40 − 20.00
        ['SO-102', { entryCount: 3, amount: '400.80' }],
        ['SO-101', { entryCount: 1, amount: '420.15' }],
      ]);
      // SO-102: newer file moved status forward, a blank optional cell erased nothing.
      expect(list.items[3]).toEqual({
        id: orderIds['SO-102'],
        subOrderNo: 'SO-102',
        orderNo: null,
        orderDate: '2026-10-02',
        productName: 'Blue_Kurti',
        sku: 'KUR-BLU-L',
        size: null,
        quantity: 2,
        customerState: 'Maharashtra',
        supplierListedPrice: '250.50',
        supplierDiscountedPrice: '230.00',
        currentStatus: 'DELIVERED',
        currentStatusObservedAt: endOfDayIst('2026-10-15'),
        settlement: { entryCount: 3, amount: '400.80' },
      });
    });

    it('statuses: raw values (case kept, exact grouping), most orders first', async () => {
      const res = await alice.get(`/accounts/${a1}/orders/statuses`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { status: 'DELIVERED', count: 3 },
          { status: 'Delivered', count: 1 },
          { status: 'RTO', count: 1 },
        ],
      });
    });

    it('filters: status (exact, repeatable), order date range, settlement matched / unmatched', async () => {
      expect(subOrders(await orders('?status=DELIVERED'))).toEqual([
        'SO-103',
        'SO-102',
        'SO-101',
      ]);
      expect(subOrders(await orders('?status=Delivered'))).toEqual(['SO-105']);
      expect(subOrders(await orders('?status=DELIVERED&status=RTO'))).toEqual([
        'SO-104',
        'SO-103',
        'SO-102',
        'SO-101',
      ]);
      const range = await orders('?from=2026-10-02&to=2026-10-04');
      expect([subOrders(range), range.total]).toEqual([
        ['SO-104', 'SO-103', 'SO-102'],
        3,
      ]);
      expect(subOrders(await orders('?settlement=matched'))).toEqual([
        'SO-102',
        'SO-101',
      ]);
      expect(subOrders(await orders('?settlement=unmatched'))).toEqual([
        'SO-105',
        'SO-104',
        'SO-103',
      ]);
      expect(
        subOrders(await orders('?status=DELIVERED&settlement=unmatched')),
      ).toEqual(['SO-103']);
    });

    it('search q: prefix on sub order / SKU (exact case), contains on product name (any case); % and _ match themselves', async () => {
      expect((await orders('?q=SO-10')).total).toBe(5);
      expect((await orders('?q=so-10')).total).toBe(0);
      expect(subOrders(await orders('?q=red%20kurti'))).toEqual([
        'SO-104',
        'SO-101',
      ]);
      // Unescaped, "KUR%" would match every KUR-… SKU; "_" would match every product.
      expect(subOrders(await orders('?q=KUR%25'))).toEqual(['SO-105']);
      expect(subOrders(await orders('?q=_'))).toEqual(['SO-102']);
      expect(
        subOrders(await orders(`?q=${encodeURIComponent('100%')}`)),
      ).toEqual(['SO-101']);
      expect((await orders('?q=%20%20')).total).toBe(5);
    });

    it('sort: allowlisted keys both ways (ties on id); pagination with total', async () => {
      expect(subOrders(await orders('?sort=subOrderNo'))).toEqual([
        'SO-101',
        'SO-102',
        'SO-103',
        'SO-104',
        'SO-105',
      ]);
      expect(subOrders(await orders('?sort=-subOrderNo'))).toEqual([
        'SO-105',
        'SO-104',
        'SO-103',
        'SO-102',
        'SO-101',
      ]);
      // currentStatus sorts case-insensitively: the D… statuses tie and fall back to id.
      expect(subOrders(await orders('?sort=currentStatus'))).toEqual([
        'SO-101',
        'SO-102',
        'SO-103',
        'SO-105',
        'SO-104',
      ]);
      expect(subOrders(await orders('?sort=orderDate'))).toEqual([
        'SO-101',
        'SO-102',
        'SO-103',
        'SO-104',
        'SO-105',
      ]);
      expect(subOrders(await orders('?sort=-updatedAt'))[0]).toBe('SO-102');
      const page2 = await orders('?pageSize=2&page=2');
      expect([
        subOrders(page2),
        page2.page,
        page2.pageSize,
        page2.total,
      ]).toEqual([['SO-103', 'SO-102'], 2, 2, 5]);
      expect(subOrders(await orders('?pageSize=2&page=3'))).toEqual(['SO-101']);
      const beyond = await orders('?pageSize=2&page=4');
      expect([beyond.items, beyond.total]).toEqual([[], 5]);
    });

    it.each([
      ['?sort=price', 'sort'],
      ['?sort=orderDate&sort=subOrderNo', 'sort'],
      ['?settlement=maybe', 'settlement'],
      ['?from=2026-02-30', 'from'],
      ['?from=2026-10-05&to=2026-10-04', 'to'],
      ['?status=', 'status'],
      ['?pageSize=101', 'pageSize'],
      ['?page=0', 'page'],
      ['?page=2001', 'page'],
      ['?includeSuperseded=true', 'includeSuperseded'],
      [`?q=${'x'.repeat(101)}`, 'q'],
    ])('400 VALIDATION_ERROR for %s (field %s)', async (query, field) => {
      const res = await alice.get(`/accounts/${a1}/orders${query}`);
      expect(
        expectError(res, 400, 'VALIDATION_ERROR').details?.map((d) => d.field),
      ).toEqual([field]);
    });

    it('every list caps page at 2000 (400 above)', async () => {
      for (const path of [
        '/orders',
        '/settlements',
        '/reconciliation/unmatched-settlements',
        '/reconciliation/orders-without-settlement',
        '/reconciliation/runs',
        '/imports',
      ]) {
        const last = await alice.get(`/accounts/${a1}${path}?page=2000`);
        expect({ path, status: last.status }).toEqual({ path, status: 200 });
        const beyond = await alice.get(`/accounts/${a1}${path}?page=2001`);
        expect({
          path,
          fields: expectError(beyond, 400, 'VALIDATION_ERROR').details?.map(
            (d) => d.field,
          ),
        }).toEqual({ path, fields: ['page'] });
      }
    });

    it('detail: fields, first / last import, status history oldest first, matched entries with amounts', async () => {
      const res = await alice.get(
        `/accounts/${a1}/orders/${orderIds['SO-102']}`,
      );
      expect(res.status).toBe(200);
      const detail = res.body as OrderDetail;
      expect(detail).toEqual(
        expect.objectContaining({
          id: orderIds['SO-102'],
          subOrderNo: 'SO-102',
          currentStatus: 'DELIVERED',
          catalogId: null,
          packetId: null,
          settlement: { entryCount: 3, amount: '400.80' },
        }),
      );
      expect([
        detail.firstImport.id,
        detail.firstImport.originalFilename,
      ]).toEqual([jobs.orders1, 'orders-1.csv']);
      // The older file (orders-0) only added history: the current values still come from orders-2.
      expect([
        detail.lastImport.id,
        detail.lastImport.originalFilename,
      ]).toEqual([jobs.orders2, 'orders-2.csv']);
      expect(
        detail.statusHistory.map((s) => [
          s.status,
          s.observedAt,
          s.importJob.id,
        ]),
      ).toEqual([
        ['PENDING', endOfDayIst('2026-10-05'), jobs.orders0],
        ['SHIPPED', endOfDayIst('2026-10-10'), jobs.orders1],
        ['DELIVERED', endOfDayIst('2026-10-15'), jobs.orders2],
      ]);
      expect(
        detail.settlements.map((s) => [
          s.id,
          s.transactionId,
          s.paymentDate,
          s.settlementAmount,
          s.match.method,
        ]),
      ).toEqual([
        [e[1], 'TXN-9', '2026-10-08', '210.40', 'auto'],
        [e[2], 'TXN-9', '2026-10-08', '210.40', 'auto'],
        [e[3], 'TXN-10', '2026-10-15', '-20.00', 'auto'],
      ]);
      const history = await alice.get(
        `/accounts/${a1}/orders/${orderIds['SO-102']}/status-history`,
      );
      expect(history.status).toBe(200);
      expect(history.body).toEqual({ items: detail.statusHistory });
    });

    it("404 for an order of another account (A2's order under A1's path) or a missing id; 400 for a malformed id", async () => {
      for (const path of [
        `/orders/${orderIds['SO-201']}`,
        `/orders/${orderIds['SO-201']}/status-history`,
        '/orders/9999999999',
        '/orders/9999999999/status-history',
      ]) {
        const res = await alice.get(`/accounts/${a1}${path}`);
        expect({
          path,
          message: expectError(res, 404, 'NOT_FOUND').message,
        }).toEqual({
          path,
          message: 'Order not found.',
        });
      }
      expect(
        (await alice.get(`/accounts/${a2}/orders/${orderIds['SO-201']}`))
          .status,
      ).toBe(200);
      expectError(
        await alice.get(`/accounts/${a1}/orders/abc`),
        400,
        'VALIDATION_ERROR',
      );
    });
  });

  describe('settlements', () => {
    it('list: every row as reported (newest payment date first), totals over all filtered rows', async () => {
      const page = await settlements();
      expect([page.page, page.pageSize, page.total]).toEqual([1, 25, 7]);
      expect(labels(page)).toEqual(['e5', 'e4', 'e7', 'e6', 'e3', 'e2', 'e1']);
      // 420.15 + 210.40 + 210.40 − 20.00 + 75.25 − 150.50 + 30.00
      expect(page.totals).toEqual({ settlementAmount: '775.70', count: 7 });
      const e1 = page.items[6];
      expect(e1).toEqual({
        id: e[0],
        entryType: 'order_payment',
        sheetName: 'Order Payments',
        transactionId: 'TXN-9',
        subOrderNo: 'SO-101',
        orderDate: '2026-10-01',
        paymentDate: '2026-10-08',
        settlementAmount: '420.15',
        saleAmount: '499.00',
        returnAmount: null,
        commissionAmount: '-60.00',
        shippingCharge: null,
        tcsAmount: '-4.23',
        tdsAmount: '-14.62',
        recoveryAmount: null,
        compensationAmount: null,
        isEstimate: false,
        supersededByEntryId: null,
        importJob: {
          id: jobs.payments,
          originalFilename: 'payments-a1.xlsx',
          createdAt: expect.any(String) as string,
        },
        createdAt: expect.any(String) as string,
        match: {
          state: 'matched',
          method: 'auto',
          orderId: orderIds['SO-101'],
          orderSubOrderNo: 'SO-101',
          matchedAt: expect.any(String) as string,
          matchedBy: null,
          autoMatchBlocked: false,
        },
      });
      expect(page.items.map((x) => x.match.state)).toEqual([
        'unmatched',
        'matched',
        'account_level',
        'account_level',
        'matched',
        'matched',
        'matched',
      ]);
    });

    it('repeated transaction IDs stay separate rows and are all summed', async () => {
      const page = await settlements('?q=TXN-9');
      expect(labels(page)).toEqual(['e3', 'e2', 'e1']);
      expect(page.items.map((x) => x.transactionId)).toEqual([
        'TXN-9',
        'TXN-9',
        'TXN-9',
      ]);
      // 210.40 + 210.40 + 420.15
      expect(page.totals).toEqual({ settlementAmount: '840.95', count: 3 });
      expect((await settlements('?q=SO-102')).totals).toEqual({
        settlementAmount: '400.80',
        count: 3,
      });
    });

    it('filters: entry type (repeatable), match state, payment date range; no rows → null total', async () => {
      const accountLevel = await settlements(
        '?entryType=ads_cost&entryType=referral_payment',
      );
      expect([labels(accountLevel), accountLevel.totals]).toEqual([
        ['e7', 'e6'],
        { settlementAmount: '-120.50', count: 2 },
      ]);
      expect((await settlements('?match=matched')).totals).toEqual({
        settlementAmount: '820.95',
        count: 4,
      });
      const unmatched = await settlements('?match=unmatched');
      expect([labels(unmatched), unmatched.totals]).toEqual([
        ['e5'],
        { settlementAmount: '75.25', count: 1 },
      ]);
      expect((await settlements('?match=account_level')).totals).toEqual({
        settlementAmount: '-120.50',
        count: 2,
      });
      expect(
        labels(await settlements('?from=2026-10-09&to=2026-10-12')),
      ).toEqual(['e7', 'e6']);
      const none = await settlements('?q=NOPE');
      expect([none.items, none.total, none.totals]).toEqual([
        [],
        0,
        { settlementAmount: null, count: 0 },
      ]);
    });

    it('sort and pagination: totals cover all filtered rows, not the page', async () => {
      expect(labels(await settlements('?sort=settlementAmount'))).toEqual([
        'e6',
        'e4',
        'e7',
        'e5',
        'e2',
        'e3',
        'e1',
      ]);
      expect(labels(await settlements('?sort=-settlementAmount'))).toEqual([
        'e1',
        'e3',
        'e2',
        'e5',
        'e7',
        'e4',
        'e6',
      ]);
      const page = await settlements('?pageSize=2');
      expect([labels(page), page.total, page.totals]).toEqual([
        ['e5', 'e4'],
        7,
        { settlementAmount: '775.70', count: 7 },
      ]);
    });

    it.each([
      ['?entryType=bonus', 'entryType'],
      ['?match=partial', 'match'],
      ['?includeSuperseded=yes', 'includeSuperseded'],
      ['?sort=amount', 'sort'],
      ['?to=2026-13-01', 'to'],
      ['?status=DELIVERED', 'status'],
    ])('400 VALIDATION_ERROR for %s', async (query, field) => {
      const res = await alice.get(`/accounts/${a1}/settlements${query}`);
      expect(
        expectError(res, 400, 'VALIDATION_ERROR').details?.map((d) => d.field),
      ).toEqual([field]);
    });

    it('superseded rows (set directly in the DB) are never summed, hidden unless asked, and cannot be (un)matched', async () => {
      // e3 (210.40, matched to SO-102) superseded by e4.
      await ctx.sequelize.query(
        'UPDATE settlement_entries SET superseded_by_entry_id = ? WHERE id = ?',
        {
          replacements: [e[3], e[2]],
        },
      );
      try {
        const page = await settlements();
        expect([page.total, labels(page)]).toEqual([
          6,
          ['e5', 'e4', 'e7', 'e6', 'e2', 'e1'],
        ]);
        // 775.70 − 210.40
        expect(page.totals).toEqual({ settlementAmount: '565.30', count: 6 });
        const all = await settlements('?includeSuperseded=true');
        expect([all.total, all.totals]).toEqual([
          7,
          { settlementAmount: '565.30', count: 6 },
        ]);
        expect(all.items.find((x) => x.id === e[2])?.supersededByEntryId).toBe(
          e[3],
        );
        expect(
          (await settlements('?q=TXN-9&includeSuperseded=true')).totals,
        ).toEqual({
          settlementAmount: '630.55',
          count: 2,
        });

        expect((await orders('?q=SO-102')).items[0].settlement).toEqual({
          entryCount: 2,
          amount: '190.40',
        });
        const detail = (
          await alice.get(`/accounts/${a1}/orders/${orderIds['SO-102']}`)
        ).body as OrderDetail;
        expect([detail.settlement, detail.settlements.length]).toEqual([
          { entryCount: 2, amount: '190.40' },
          3,
        ]);
        const o = await overview();
        expect([
          o.settlements.total,
          o.settlements.matched,
          o.settlements.matchedAmount,
        ]).toEqual([6, 3, '610.55']);

        const matched = await match(alice, e[2], orderIds['SO-103']);
        expect(expectError(matched, 409, 'CONFLICT').message).toMatch(
          /superseded/,
        );
        expectError(await unmatch(alice, e[2]), 409, 'CONFLICT');
        expect(await auditOf(e[2])).toEqual([]);
      } finally {
        await ctx.sequelize.query(
          'UPDATE settlement_entries SET superseded_by_entry_id = NULL WHERE id = ?',
          {
            replacements: [e[2]],
          },
        );
      }
      expect((await settlements()).totals).toEqual({
        settlementAmount: '775.70',
        count: 7,
      });
    });

    it('a superseded UNMATCHED entry leaves the exceptions and every sum; an order whose only entry is superseded has no settlement', async () => {
      // e5 (SO-999, 75.25, unmatched) and e1 (420.15, the only entry of SO-101) superseded by e4.
      await ctx.sequelize.query(
        'UPDATE settlement_entries SET superseded_by_entry_id = ? WHERE id IN (?, ?)',
        { replacements: [e[3], e[4], e[0]] },
      );
      try {
        const unmatched = (
          await alice.get(
            `/accounts/${a1}/reconciliation/unmatched-settlements`,
          )
        ).body as Page<Entry>;
        expect([unmatched.items, unmatched.total]).toEqual([[], 0]);
        const o = await overview();
        // Left: e2 + e3 + e4 = 400.80 matched; e6 + e7 = −120.50 account level.
        expect(o.settlements).toEqual({
          total: 5,
          matched: 3,
          unmatched: 0,
          accountLevel: 2,
          matchedAmount: '400.80',
          unmatchedAmount: null,
          accountLevelAmount: '-120.50',
        });
        expect(o.orders).toEqual({
          total: 5,
          withSettlement: 1,
          withoutSettlement: 4,
        });
        expect(o.withoutSettlementByStatus).toEqual([
          { status: 'DELIVERED', count: 2 },
          { status: 'Delivered', count: 1 },
          { status: 'RTO', count: 1 },
        ]);
        const page = await settlements('?match=unmatched');
        expect([page.items, page.total, page.totals]).toEqual([
          [],
          0,
          { settlementAmount: null, count: 0 },
        ]);
        const shown = await settlements(
          '?match=unmatched&includeSuperseded=true',
        );
        expect([labels(shown), shown.total, shown.totals]).toEqual([
          ['e5'],
          1,
          { settlementAmount: null, count: 0 },
        ]);

        const without = (
          await alice.get(
            `/accounts/${a1}/reconciliation/orders-without-settlement`,
          )
        ).body as Page<OrderSummary>;
        expect(subOrders(without)).toEqual([
          'SO-105',
          'SO-104',
          'SO-103',
          'SO-101',
        ]);
        const list = await orders('?settlement=unmatched');
        expect(subOrders(list)).toEqual([
          'SO-105',
          'SO-104',
          'SO-103',
          'SO-101',
        ]);
        expect(list.items[3].settlement).toEqual({
          entryCount: 0,
          amount: null,
        });
        expect(subOrders(await orders('?settlement=matched'))).toEqual([
          'SO-102',
        ]);
        const detail = (
          await alice.get(`/accounts/${a1}/orders/${orderIds['SO-101']}`)
        ).body as OrderDetail;
        expect([
          detail.settlement,
          detail.settlements.map((x) => [x.id, x.supersededByEntryId]),
        ]).toEqual([{ entryCount: 0, amount: null }, [[e[0], e[3]]]]);
      } finally {
        await ctx.sequelize.query(
          'UPDATE settlement_entries SET superseded_by_entry_id = NULL WHERE id IN (?, ?)',
          { replacements: [e[4], e[0]] },
        );
      }
      expect((await overview()).settlements).toEqual(
        expect.objectContaining({ unmatched: 1, matchedAmount: '820.95' }),
      );
    });
  });

  describe('reconciliation', () => {
    /** Test arrangement straight in the DB: e1 unmatched and NOT blocked, so a run matches it to SO-101. */
    async function makeE1Matchable(): Promise<void> {
      await ctx.sequelize.query(
        `UPDATE settlement_entries SET order_id = NULL, match_method = NULL, matched_at = NULL,
                matched_by_user_id = NULL, auto_match_blocked = 0 WHERE id = ?`,
        { replacements: [e[0]] },
      );
    }

    const e1Row = () => SettlementEntry.findByPk(e[0], { rejectOnEmpty: true });

    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    /** Locks the A1 account row in a separate transaction (another pool connection), as an import does. */
    async function holdAccountLock() {
      const holder = await ctx.sequelize.transaction();
      await ctx.sequelize.query(
        'SELECT id FROM seller_accounts WHERE id = ? FOR UPDATE',
        { replacements: [a1], transaction: holder },
      );
      return holder;
    }

    /**
     * Sends `request` while the account row is locked elsewhere and proves the lock is its FIRST step: after
     * 800 ms it has not answered and it holds no lock on e1 (NOWAIT succeeds; without `lock: true` it would
     * already have updated / locked e1 and only then wait on the foreign-key check). Then releases the lock
     * and returns the response.
     */
    async function whileAccountLocked(
      request: () => Promise<Response>,
    ): Promise<Response> {
      const holder = await holdAccountLock();
      let settled = false;
      const pending = request().finally(() => {
        settled = true;
      });
      try {
        await wait(800);
        expect(settled).toBe(false);
        await ctx.sequelize.query(
          'SELECT id FROM settlement_entries WHERE id = ? FOR UPDATE NOWAIT',
          { replacements: [e[0]], transaction: holder },
        );
      } catch (err) {
        await holder.rollback();
        await pending.catch(() => undefined);
        throw err;
      }
      await holder.rollback();
      return pending;
    }

    it('overview: counts and as-reported sums, orders with / without settlement, last run', async () => {
      const o = await overview();
      expect(o).toEqual({
        lastRun: expect.objectContaining({
          triggerType: 'import',
          importJobId: jobs.orders0,
          matchedCount: 0,
          unmatchedSettlementCount: 1,
          unmatchedOrderCount: 3,
        }) as Run,
        settlements: {
          total: 7,
          matched: 4,
          unmatched: 1,
          accountLevel: 2,
          matchedAmount: '820.95',
          unmatchedAmount: '75.25',
          accountLevelAmount: '-120.50',
        },
        orders: { total: 5, withSettlement: 2, withoutSettlement: 3 },
        withoutSettlementByStatus: [
          { status: 'DELIVERED', count: 1 },
          { status: 'Delivered', count: 1 },
          { status: 'RTO', count: 1 },
        ],
      });
    });

    it('exceptions: unmatched settlements (account-level entries never) and orders without settlement by status', async () => {
      const unmatched = await alice.get(
        `/accounts/${a1}/reconciliation/unmatched-settlements`,
      );
      expect(unmatched.status).toBe(200);
      const page = unmatched.body as Page<Entry>;
      expect([labels(page), page.total, page.pageSize]).toEqual([
        ['e5'],
        1,
        25,
      ]);
      expect(page.items[0].match).toEqual(
        expect.objectContaining({
          state: 'unmatched',
          orderId: null,
          autoMatchBlocked: false,
        }),
      );

      const without = await alice.get(
        `/accounts/${a1}/reconciliation/orders-without-settlement`,
      );
      expect(without.status).toBe(200);
      const list = without.body as Page<OrderSummary>;
      expect([subOrders(list), list.total]).toEqual([
        ['SO-105', 'SO-104', 'SO-103'],
        3,
      ]);
      const rto = await alice.get(
        `/accounts/${a1}/reconciliation/orders-without-settlement?status=RTO&sort=subOrderNo`,
      );
      expect(subOrders(rto.body as Page<OrderSummary>)).toEqual(['SO-104']);
      expectError(
        await alice.get(
          `/accounts/${a1}/reconciliation/orders-without-settlement?q=SO`,
        ),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(
          `/accounts/${a1}/reconciliation/unmatched-settlements?sort=nope`,
        ),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('run now: a member may run it (201, trigger manual) and the counts are recorded', async () => {
      const res = await carol.post(`/accounts/${a1}/reconciliation/runs`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual(
        expect.objectContaining({
          triggerType: 'manual',
          status: 'completed',
          importJobId: null,
          triggeredBy: {
            id: carolId,
            displayName: 'carol',
            email: email('carol'),
          },
          matchedCount: 0,
          unmatchedSettlementCount: 1,
          unmatchedOrderCount: 3,
          failureMessage: null,
        }),
      );
      const runs = await alice.get(
        `/accounts/${a1}/reconciliation/runs?pageSize=2`,
      );
      const body = runs.body as Page<Run>;
      expect([body.total, body.items.length, body.items[0].id]).toEqual([
        5,
        2,
        (res.body as Run).id,
      ]);
      expect((await overview()).lastRun?.id).toBe((res.body as Run).id);
    });

    it('manual match: owner only (member 403, stranger 404); entry and order must be in this account (404)', async () => {
      expectError(
        await match(carol, e[4], orderIds['SO-103']),
        403,
        'FORBIDDEN',
      );
      expectError(await match(bob, e[4], orderIds['SO-103']), 404, 'NOT_FOUND');
      expect(
        expectError(
          await match(alice, e[4], orderIds['SO-201']),
          404,
          'NOT_FOUND',
        ).message,
      ).toBe('Order not found.');
      expect(
        expectError(
          await match(alice, a2Entries[2], orderIds['SO-103']),
          404,
          'NOT_FOUND',
        ).message,
      ).toBe('Settlement entry not found.');
      expectError(
        await match(alice, '9999999999', orderIds['SO-103']),
        404,
        'NOT_FOUND',
      );
      expect(
        expectError(
          await alice.post(`/accounts/${a1}/reconciliation/manual-match`, {
            settlementEntryId: e[4],
          }),
          400,
          'VALIDATION_ERROR',
        ).details?.map((d) => d.field),
      ).toEqual(['orderId']);
      // An account-level entry (ads cost, no sub order) cannot be matched to an order.
      expectError(
        await match(alice, e[5], orderIds['SO-103']),
        409,
        'CONFLICT',
      );
      expect((await alice.get(`/accounts/${a1}/reconciliation`)).body).toEqual(
        expect.objectContaining({
          settlements: expect.objectContaining({
            unmatched: 1,
            matched: 4,
          }) as object,
        }),
      );
      expect(await auditOf(e[4])).toEqual([]);
    });

    it('manual match: owner 200 (manual, who, when), audit row; the same order again is a no-op', async () => {
      const res = await match(alice, e[4], orderIds['SO-103']);
      expect(res.status).toBe(200);
      const entry = res.body as Entry;
      expect(entry.id).toBe(e[4]);
      expect(entry.match).toEqual({
        state: 'matched',
        method: 'manual',
        orderId: orderIds['SO-103'],
        orderSubOrderNo: 'SO-103',
        matchedAt: expect.any(String) as string,
        matchedBy: { id: aliceId, displayName: 'alice', email: email('alice') },
        autoMatchBlocked: false,
      });
      const audit = await auditOf(e[4]);
      expect(audit).toEqual([
        {
          action: 'settlement_entry.matched',
          actorUserId: Number(aliceId),
          sellerAccountId: Number(a1),
          beforeData: { orderId: null, matchMethod: null },
          afterData: { orderId: orderIds['SO-103'], matchMethod: 'manual' },
        },
      ]);
      const again = await match(alice, e[4], orderIds['SO-103']);
      expect([again.status, (again.body as Entry).match]).toEqual([
        200,
        entry.match,
      ]);
      expect(await auditOf(e[4])).toHaveLength(1);

      const o = await overview();
      expect([
        o.settlements.unmatched,
        o.settlements.matched,
        o.orders.withSettlement,
      ]).toEqual([0, 5, 3]);
      const unmatched = (
        await alice.get(`/accounts/${a1}/reconciliation/unmatched-settlements`)
      ).body as Page<Entry>;
      expect(unmatched.total).toBe(0);
    });

    it('manual unmatch: owner only; clears the match, blocks auto-match; a later run does NOT re-match; 409 when not matched', async () => {
      expectError(await unmatch(carol, e[0]), 403, 'FORBIDDEN');
      const res = await unmatch(alice, e[0]);
      expect(res.status).toBe(200);
      expect((res.body as Entry).match).toEqual({
        state: 'unmatched',
        method: null,
        orderId: null,
        orderSubOrderNo: null,
        matchedAt: null,
        matchedBy: null,
        autoMatchBlocked: true,
      });
      expect(await auditOf(e[0])).toEqual([
        expect.objectContaining({
          action: 'settlement_entry.unmatched',
          beforeData: { orderId: orderIds['SO-101'], matchMethod: 'auto' },
          afterData: { orderId: null, matchMethod: null },
        }),
      ]);
      expectError(await unmatch(alice, e[0]), 409, 'CONFLICT');

      const run = await carol.post(`/accounts/${a1}/reconciliation/runs`);
      expect(run.body).toEqual(
        expect.objectContaining({
          matchedCount: 0,
          // e1 (blocked) is the only unmatched entry; SO-101, SO-104, SO-105 have no settlement.
          unmatchedSettlementCount: 1,
          unmatchedOrderCount: 3,
        }),
      );
      const stillUnmatched = (
        await alice.get(`/accounts/${a1}/reconciliation/unmatched-settlements`)
      ).body as Page<Entry>;
      expect([
        labels(stillUnmatched),
        stillUnmatched.items[0].match.autoMatchBlocked,
      ]).toEqual([['e1'], true]);
    });

    it('manual match again clears the block; an owner may re-point a manual match', async () => {
      const res = await match(alice, e[0], orderIds['SO-101']);
      expect((res.body as Entry).match).toEqual(
        expect.objectContaining({
          method: 'manual',
          orderId: orderIds['SO-101'],
          autoMatchBlocked: false,
        }),
      );
      const repointed = await match(alice, e[0], orderIds['SO-104']);
      expect((repointed.body as Entry).match.orderId).toBe(orderIds['SO-104']);
      expect(
        (await auditOf(e[0])).map((a) => [a.action, a.beforeData, a.afterData]),
      ).toEqual([
        [
          'settlement_entry.unmatched',
          { orderId: orderIds['SO-101'], matchMethod: 'auto' },
          { orderId: null, matchMethod: null },
        ],
        [
          'settlement_entry.matched',
          { orderId: null, matchMethod: null },
          { orderId: orderIds['SO-101'], matchMethod: 'manual' },
        ],
        [
          'settlement_entry.matched',
          { orderId: orderIds['SO-101'], matchMethod: 'manual' },
          { orderId: orderIds['SO-104'], matchMethod: 'manual' },
        ],
      ]);
      const run = await alice.post(`/accounts/${a1}/reconciliation/runs`);
      expect((run.body as Run).matchedCount).toBe(0);
      expect((await orders('?q=SO-104')).items[0].settlement).toEqual({
        entryCount: 1,
        amount: '420.15',
      });
    });

    it('a failed manual run → 500, its matching rolled back, and recorded as a failed run', async () => {
      await makeE1Matchable();
      const create = jest
        .spyOn(ReconciliationRun, 'create')
        .mockRejectedValueOnce(new Error('simulated'));
      const res = await carol
        .post(`/accounts/${a1}/reconciliation/runs`)
        .finally(() => create.mockRestore());
      expectError(res, 500, 'INTERNAL_ERROR');
      const [latest] = await runsOf(a1);
      expect(latest).toEqual(
        expect.objectContaining({
          triggerType: 'manual',
          status: 'failed',
          importJobId: null,
          triggeredBy: {
            id: carolId,
            displayName: 'carol',
            email: email('carol'),
          },
          finishedAt: expect.any(String) as string,
          matchedCount: null,
          unmatchedSettlementCount: null,
          unmatchedOrderCount: null,
          failureMessage: RUN_FAILED_MESSAGE,
        }),
      );
      // The run had matched e1 to SO-101 before failing: rolled back with it.
      expect((await e1Row()).orderId).toBeNull();
    });

    it('run now takes the account lock FIRST: it waits while another transaction holds it, then runs', async () => {
      const res = await whileAccountLocked(() =>
        carol.post(`/accounts/${a1}/reconciliation/runs`),
      );
      expect([res.status, (res.body as Run).matchedCount]).toEqual([201, 1]);
      expect([
        (await e1Row()).matchMethod,
        String((await e1Row()).orderId),
      ]).toEqual(['auto', orderIds['SO-101']]);
    });

    it('manual match takes the account lock first', async () => {
      const res = await whileAccountLocked(() =>
        match(alice, e[0], orderIds['SO-104']),
      );
      expect([
        res.status,
        (res.body as Entry).match.method,
        (res.body as Entry).match.orderId,
      ]).toEqual([200, 'manual', orderIds['SO-104']]);
    });

    it('manual unmatch takes the account lock first', async () => {
      const res = await whileAccountLocked(() => unmatch(alice, e[0]));
      expect([res.status, (res.body as Entry).match.autoMatchBlocked]).toEqual([
        200,
        true,
      ]);
    });

    it('a lock wait timeout on the account → 409 "try again shortly"; nothing changed, no failed run', async () => {
      const access = ctx.app.get(WorkspaceAccessService);
      const requireAccount = access.requireAccount.bind(access);
      // These requests only: give up on a row lock after 1 s instead of the server default (50 s).
      const shortWait = jest
        .spyOn(access, 'requireAccount')
        .mockImplementation(async (userId, accountId, minRole, options) => {
          if (!options?.lock) {
            return requireAccount(userId, accountId, minRole, options);
          }
          const session = { transaction: options.transaction };
          await ctx.sequelize.query(
            'SET SESSION innodb_lock_wait_timeout = 1',
            session,
          );
          try {
            return await requireAccount(userId, accountId, minRole, options);
          } finally {
            await ctx.sequelize.query(
              'SET SESSION innodb_lock_wait_timeout = DEFAULT',
              session,
            );
          }
        });
      const runsBefore = (
        (await alice.get(`/accounts/${a1}/reconciliation/runs?pageSize=1`))
          .body as Page<Run>
      ).total;
      const holder = await holdAccountLock();
      try {
        const run = await carol.post(`/accounts/${a1}/reconciliation/runs`);
        expect(expectError(run, 409, 'CONFLICT').message).toBe(
          ACCOUNT_BUSY_MESSAGE,
        );
        const matched = await match(alice, e[0], orderIds['SO-101']);
        expect(expectError(matched, 409, 'CONFLICT').message).toBe(
          ACCOUNT_BUSY_MESSAGE,
        );
        const unmatched = await unmatch(alice, e[1]);
        expect(expectError(unmatched, 409, 'CONFLICT').message).toBe(
          ACCOUNT_BUSY_MESSAGE,
        );
      } finally {
        await holder.rollback();
        shortWait.mockRestore();
      }
      expect(
        (
          (await alice.get(`/accounts/${a1}/reconciliation/runs?pageSize=1`))
            .body as Page<Run>
        ).total,
      ).toBe(runsBefore);
      expect([
        (await e1Row()).orderId,
        (await e1Row()).autoMatchBlocked,
      ]).toEqual([null, true]);
      expect(
        (await SettlementEntry.findByPk(e[1], { rejectOnEmpty: true }))
          .matchMethod,
      ).toBe('auto');
    });

    it("manual unmatch of another account's entry (A2's under A1's path) → 404; nothing changed", async () => {
      expect(
        expectError(await unmatch(alice, a2Entries[0]), 404, 'NOT_FOUND')
          .message,
      ).toBe('Settlement entry not found.');
      expect(
        (await SettlementEntry.findByPk(a2Entries[0], { rejectOnEmpty: true }))
          .matchMethod,
      ).toBe('auto');
      expect(await auditOf(a2Entries[0])).toEqual([]);
    });

    it('a disabled account: manual match and manual unmatch → 409; nothing changed', async () => {
      expect((await alice.delete(`/accounts/${a2}`)).status).toBe(200);
      try {
        const matched = await match(
          alice,
          a2Entries[2],
          orderIds['SO-201'],
          a2,
        );
        expect(expectError(matched, 409, 'CONFLICT').message).toBe(
          RUN_ACCOUNT_DISABLED_MESSAGE,
        );
        const unmatched = await unmatch(alice, a2Entries[0], a2);
        expect(expectError(unmatched, 409, 'CONFLICT').message).toBe(
          RUN_ACCOUNT_DISABLED_MESSAGE,
        );
      } finally {
        expect(
          (await alice.patch(`/accounts/${a2}`, { status: 'active' })).status,
        ).toBe(200);
      }
      const entries = await SettlementEntry.findAll({
        where: { sellerAccountId: Number(a2) },
        order: [['id', 'ASC']],
      });
      expect(entries.map((x) => [x.matchMethod, x.autoMatchBlocked])).toEqual([
        ['auto', false],
        ['auto', false],
        [null, false],
      ]);
    });

    it('a disabled account can be read but not reconciled (409)', async () => {
      const shut = await createAccount('Closed shop');
      expect((await alice.delete(`/accounts/${shut}`)).status).toBe(200);
      expect((await alice.get(`/accounts/${shut}/orders`)).status).toBe(200);
      expect(
        (await alice.get(`/accounts/${shut}/reconciliation`)).body,
      ).toEqual(
        expect.objectContaining({
          lastRun: null,
          orders: { total: 0, withSettlement: 0, withoutSettlement: 0 },
        }),
      );
      expectError(
        await alice.post(`/accounts/${shut}/reconciliation/runs`),
        409,
        'CONFLICT',
      );
    });
  });

  describe('tenancy, CSRF and sessions', () => {
    it("a stranger gets 404 on every new route for A1's account", async () => {
      const gets = [
        '/orders',
        '/orders/statuses',
        `/orders/${orderIds['SO-101']}`,
        `/orders/${orderIds['SO-101']}/status-history`,
        '/settlements',
        '/reconciliation',
        '/reconciliation/unmatched-settlements',
        '/reconciliation/orders-without-settlement',
        '/reconciliation/runs',
      ];
      for (const path of gets) {
        const res = await bob.get(`/accounts/${a1}${path}`);
        expect({
          path,
          status: res.status,
          code: (res.body as ErrorBody).error?.code,
        }).toEqual({
          path,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      const posts: [string, object | undefined][] = [
        ['/reconciliation/runs', undefined],
        [
          '/reconciliation/manual-match',
          { settlementEntryId: e[0], orderId: orderIds['SO-101'] },
        ],
        ['/reconciliation/manual-unmatch', { settlementEntryId: e[0] }],
      ];
      for (const [path, body] of posts) {
        const res = await bob.post(`/accounts/${a1}${path}`, body);
        expect({ path, status: res.status }).toEqual({ path, status: 404 });
      }
      // Nothing changed for A1.
      expect(
        (await runsOf(a1)).filter((r) => r.triggeredBy?.email === email('bob')),
      ).toEqual([]);
    });

    it('POST without the XSRF header → 403; no session → 401', async () => {
      expectError(
        await carol.post(`/accounts/${a1}/reconciliation/runs`, undefined, {
          csrf: false,
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await new TestClient(ctx.server).get(`/accounts/${a1}/orders`),
        401,
        'UNAUTHORIZED',
      );
    });
  });
});
