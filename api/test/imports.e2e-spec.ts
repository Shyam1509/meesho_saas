import { QueryTypes } from 'sequelize';
import request, { type Response } from 'supertest';
import {
  ImportJob,
  ImportRow,
  Order,
  OrderStatusEvent,
  Product,
  SellerAccount,
  SettlementEntry,
  WorkspaceMember,
} from '../src/database/models';
import { ImportParseLimiter } from '../src/imports/import-parse-limiter';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
  TEST_CLIENT_IP_HEADER,
} from './support/e2e-app';
import {
  csv,
  notAWorkbookZip,
  rawWorkbook,
  rowXml,
  workbook,
  zeroBombXlsx,
  type Cell,
} from './support/import-fixtures';
import {
  type ErrorBody,
  TestClient,
  withoutRequestId,
} from './support/test-client';

const PASSWORD = 'correct horse battery';
const MAX_ROWS = 25;

interface ImportRowBody {
  id: string;
  sheetName: string;
  rowNumber: number;
  status: string;
  action: string | null;
  errors: { field: string; reason: string }[];
  values: Record<string, string | null>;
}

interface Planned {
  insert: number;
  update: number;
  unchanged: number;
  historyOnly: number;
  statusEvents: number;
}

interface ImportBody {
  id: string;
  sellerAccountId: string;
  reportType: string;
  status: string;
  originalFilename: string;
  fileSizeBytes: number;
  totalRows: number | null;
  validRows: number | null;
  errorRows: number | null;
  insertedCount: number | null;
  updatedCount: number | null;
  unchangedCount: number | null;
  historyOnlyCount: number | null;
  reportPeriodStart: string | null;
  reportPeriodEnd: string | null;
  dataAsOf: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string | null; email: string };
  confirmedAt: string | null;
  completedAt: string | null;
  failureMessage: string | null;
  allowedActions: string[];
  preview: {
    sheets: {
      name: string;
      entryType: string | null;
      ignored: boolean;
      rows: number;
      validRows: number;
      errorRows: number;
      recognisedColumns: string[];
      missingOptionalColumns: string[];
      ignoredColumns: string[];
    }[];
    planned: Planned;
    sampleRows: ImportRowBody[];
  };
}

interface PageBody<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const planned = (p: Partial<Planned>): Planned => ({
  insert: 0,
  update: 0,
  unchanged: 0,
  historyOnly: 0,
  statusEvents: 0,
  ...p,
});

/** dataAsOf D means the end of day D in India: 23:59:59.999 IST. */
const endOfDayIst = (date: string) =>
  new Date(`${date}T23:59:59.999+05:30`).toISOString();

const ORDER_HEADER = [
  'Sub Order No',
  'Order Date',
  'Reason for Credit Entry',
  'Quantity',
  'SKU',
  'Supplier Listed Price (Incl. GST + Commission)',
  'Customer State',
];

const PAYMENT_HEADER = [
  'Sub Order No',
  'Transaction ID',
  'Order Date',
  'Payment Date',
  'Final Settlement Amount',
  'Total Sale Amount (Incl. Shipping & GST)',
  'Meesho Commission (Incl. GST)',
];

/**
 * Import pipeline against meesho_test: upload → preview → confirm / retry / cancel, idempotency,
 * observation times, partial imports, file-level rejections and limits, settlements, rollback,
 * concurrency, stale imports, tenancy and CSRF.
 *
 * Alice owns workspace A with accounts "Shop" (orders), "Payments" (settlements, imported by Carol, a
 * member of A), a disabled account and a few more for isolated scenarios. Bob owns workspace B and is a
 * stranger to A. Every upload uses its own client IP (TEST_CLIENT_IP_HEADER) so the 20-per-minute upload
 * throttle only bites in the test that is about it.
 */
describe('imports (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;

  let alice: TestClient;
  let bob: TestClient;
  let bobId: number;
  let carol: TestClient;
  let wsA: string;
  let shop: string;
  let payments: string;
  let disabled: string;
  let ipSeq = 0;

  const freshIp = () => {
    ipSeq += 1;
    return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };

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

  /** Multipart upload from a fresh client IP (pass `ip` to pin one). */
  function send(
    client: TestClient,
    accountId: string,
    file: { name: string; content: Buffer | string; fieldName?: string },
    fields: Record<string, string> = {},
    options: { csrf?: boolean | string; ip?: string; origin?: string } = {},
  ) {
    const headers: Record<string, string> = {
      [TEST_CLIENT_IP_HEADER]: options.ip ?? freshIp(),
    };
    if (options.origin) headers.Origin = options.origin;
    return client.upload(`/accounts/${accountId}/imports`, file, fields, {
      csrf: options.csrf,
      headers,
    });
  }

  /** Orders CSV upload; dataAsOf defaults to 2026-10-10 (null = omit it). */
  function uploadCsv(
    client: TestClient,
    accountId: string,
    name: string,
    rows: Cell[][],
    dataAsOf: string | null = '2026-10-10',
    extra: Record<string, string> = {},
  ) {
    return send(
      client,
      accountId,
      { name, content: csv(rows) },
      dataAsOf ? { dataAsOf, ...extra } : extra,
    );
  }

  async function uploadOk(res: Promise<Response>): Promise<ImportBody> {
    const done = await res;
    expect({
      status: done.status,
      body: done.status === 201 ? null : (done.body as unknown),
    }).toEqual({
      status: 201,
      body: null,
    });
    return done.body as ImportBody;
  }

  async function jobCount(accountId: string): Promise<number> {
    return ImportJob.count({ where: { sellerAccountId: Number(accountId) } });
  }

  async function order(
    accountId: string,
    subOrderNo: string,
  ): Promise<Order | null> {
    return Order.findOne({
      where: { sellerAccountId: Number(accountId), subOrderNo },
    });
  }

  async function statusHistory(
    orderId: number,
  ): Promise<[string, string, number][]> {
    const events = await OrderStatusEvent.findAll({
      where: { orderId },
      order: [
        ['observedAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    return events.map((e) => [
      e.status,
      e.observedAt.toISOString(),
      e.importJobId,
    ]);
  }

  interface AuditRow {
    action: string;
    beforeData: unknown;
    afterData: unknown;
    requestId: string;
  }

  async function auditOf(jobId: string): Promise<AuditRow[]> {
    return ctx.sequelize.query<AuditRow>(
      `SELECT action, before_data AS beforeData, after_data AS afterData, request_id AS requestId
       FROM audit_logs WHERE entity_type = 'import_job' AND entity_id = ? ORDER BY id`,
      { replacements: [jobId], type: QueryTypes.SELECT },
    );
  }

  beforeAll(async () => {
    ctx = await createE2eApp({ importMaxFileMb: 1, importMaxRows: MAX_ROWS });
    const a = await register('alice', 'Imports A');
    const b = await register('bob', 'Imports B');
    const c = await register('carol', 'Carol own');
    alice = a.client;
    bob = b.client;
    bobId = Number(b.me.user.id);
    carol = c.client;
    wsA = a.me.workspaces[0].id;
    await WorkspaceMember.create({
      workspaceId: Number(wsA),
      userId: Number(c.me.user.id),
      role: 'member',
    });
    shop = await createAccount('Shop');
    payments = await createAccount('Payments');
    disabled = await createAccount('Old shop');
    expect((await alice.delete(`/accounts/${disabled}`)).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  describe('orders CSV: preview, confirm, idempotency and observation time', () => {
    let job1: ImportBody;
    let job2: ImportBody;
    let jobEqual: ImportBody;

    const file1: Cell[][] = [
      ORDER_HEADER,
      ['SO-1', '01-10-2026', 'SHIPPED', '1', 'SKU-A', '₹499.00', 'Gujarat'],
      ['SO-2', '02-10-2026', 'SHIPPED', '2', 'SKU-B', '250.5', 'Maharashtra'],
      ['SO-3', '03-10-2026', 'DELIVERED', '1', 'SKU-A', '499', 'Gujarat'],
    ];

    it('upload → 201 previewed with counts, period, columns, planned actions and allowedActions; nothing imported yet', async () => {
      job1 = await uploadOk(uploadCsv(alice, shop, 'orders-oct.csv', file1));
      expect(job1).toEqual(
        expect.objectContaining({
          sellerAccountId: shop,
          reportType: 'orders_csv',
          status: 'previewed',
          originalFilename: 'orders-oct.csv',
          fileSizeBytes: Buffer.byteLength(csv(file1)),
          totalRows: 3,
          validRows: 3,
          errorRows: 0,
          insertedCount: null,
          updatedCount: null,
          unchangedCount: null,
          historyOnlyCount: null,
          reportPeriodStart: '2026-10-01',
          reportPeriodEnd: '2026-10-03',
          dataAsOf: endOfDayIst('2026-10-10'),
          confirmedAt: null,
          completedAt: null,
          failureMessage: null,
          allowedActions: ['confirm', 'cancel'],
        }),
      );
      expect(job1.dataAsOf).toBe('2026-10-10T18:29:59.999Z');
      expect(job1.createdBy).toEqual({
        id: expect.any(String) as string,
        displayName: 'alice',
        email: email('alice'),
      });
      expect(job1.preview.planned).toEqual(
        planned({ insert: 3, statusEvents: 3 }),
      );
      expect(job1.preview.sheets).toEqual([
        {
          name: '',
          entryType: null,
          ignored: false,
          rows: 3,
          validRows: 3,
          errorRows: 0,
          recognisedColumns: ORDER_HEADER,
          missingOptionalColumns: [
            'Order No',
            'Catalog ID',
            'Product Name',
            'Size',
            'Supplier Discounted Price',
            'Packet Id',
          ],
          ignoredColumns: [],
        },
      ]);
      expect(
        job1.preview.sampleRows.map((r) => [r.rowNumber, r.status, r.action]),
      ).toEqual([
        [2, 'valid', 'insert'],
        [3, 'valid', 'insert'],
        [4, 'valid', 'insert'],
      ]);
      expect(job1.preview.sampleRows[1].values).toEqual({
        subOrderNo: 'SO-2',
        orderDate: '2026-10-02',
        status: 'SHIPPED',
        quantity: '2',
        sku: 'SKU-B',
        supplierListedPrice: '250.50',
        customerState: 'Maharashtra',
      });
      expect(
        await Order.count({ where: { sellerAccountId: Number(shop) } }),
      ).toBe(0);
      const stored = await ImportJob.findByPk(job1.id);
      expect(stored?.storageKey).toBeNull();
    });

    it('GET /imports/:id and the account list return it', async () => {
      const detail = await alice.get(`/imports/${job1.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toEqual(job1);
      const list = (await alice.get(`/accounts/${shop}/imports`))
        .body as PageBody<ImportBody>;
      expect(list).toEqual(
        expect.objectContaining({ page: 1, pageSize: 20, total: 1 }),
      );
      expect(list.items[0]).not.toHaveProperty('preview');
      expect(list.items[0].allowedActions).toEqual(['confirm', 'cancel']);
    });

    it('confirm → 200 completed: orders + one status event each, rows imported, audit, no further actions', async () => {
      const res = await alice.post(`/imports/${job1.id}/confirm`, {});
      expect(res.status).toBe(200);
      const done = res.body as ImportBody;
      expect(done).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 3,
          updatedCount: 0,
          unchangedCount: 0,
          historyOnlyCount: 0,
          allowedActions: [],
        }),
      );
      const so2 = (await order(shop, 'SO-2')) as Order;
      // M6: the confirm created one product per SKU (SKU-A, SKU-B) and mapped each order to its SKU's product.
      const skuB = await Product.findOne({
        where: { sellerAccountId: Number(shop), sku: 'SKU-B' },
      });
      expect(skuB).not.toBeNull();
      expect(so2).toEqual(
        expect.objectContaining({
          orderDate: '2026-10-02',
          quantity: 2,
          supplierListedPrice: '250.50',
          productId: skuB?.id,
          currentStatus: 'SHIPPED',
          firstImportJobId: Number(job1.id),
          lastImportJobId: Number(job1.id),
        }),
      );
      expect(so2.currentStatusObservedAt.toISOString()).toBe(
        endOfDayIst('2026-10-10'),
      );
      expect(
        await OrderStatusEvent.count({
          where: { importJobId: Number(job1.id) },
        }),
      ).toBe(3);
      expect(await auditOf(job1.id)).toEqual([
        {
          action: 'import.confirmed',
          beforeData: null,
          afterData: {
            reportType: 'orders_csv',
            insertedCount: 3,
            updatedCount: 0,
            unchangedCount: 0,
            historyOnlyCount: 0,
            statusEvents: 3,
            skippedRows: 0,
            retry: false,
            createdProducts: 2,
            linkedOrders: 3,
          },
          requestId: res.headers['x-request-id'],
        },
      ]);
    });

    it('re-uploading the same file → 409 naming the earlier import; no job is created', async () => {
      const before = await jobCount(shop);
      const res = await uploadCsv(alice, shop, 'renamed-copy.csv', file1);
      expect(expectError(res, 409, 'CONFLICT').details).toEqual([
        { field: 'file', reasons: [`Already imported as import ${job1.id}`] },
      ]);
      expect(await jobCount(shop)).toBe(before);
      expectError(
        await alice.post(`/imports/${job1.id}/confirm`, {}),
        409,
        'CONFLICT',
      );
    });

    it('overlapping newer report: changed status → update + event, same values → unchanged; unmapped columns never stored', async () => {
      job2 = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-oct-2.csv',
          [
            ['Customer Phone', ...ORDER_HEADER],
            [
              '+91 98765 43210',
              'SO-1',
              '01-10-2026',
              'DELIVERED',
              '1',
              'SKU-A',
              '499.00',
              'Gujarat',
            ],
            [
              '+91 90000 00000',
              'SO-2',
              '02-10-2026',
              'SHIPPED',
              '2',
              'SKU-B',
              '250.50',
              'Maharashtra',
            ],
            [
              '+91 91111 11111',
              'SO-4',
              '05-10-2026',
              'SHIPPED',
              '3',
              'SKU-C',
              '100',
              'Delhi',
            ],
          ],
          '2026-10-20',
        ),
      );
      expect(job2.dataAsOf).toBe(endOfDayIst('2026-10-20'));
      expect(job2.preview.planned).toEqual(
        planned({ insert: 1, update: 1, unchanged: 1, statusEvents: 3 }),
      );
      expect(job2.preview.sheets[0].ignoredColumns).toEqual(['Customer Phone']);
      const staged = await ImportRow.findAll({
        where: { importJobId: Number(job2.id) },
      });
      expect(JSON.stringify(staged.map((r) => r.sourceValues))).not.toMatch(
        /98765|90000|91111/,
      );

      const confirmed = await alice.post(`/imports/${job2.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 1,
          updatedCount: 1,
          unchangedCount: 1,
          historyOnlyCount: 0,
        }),
      );
      const rows = (await alice.get(`/imports/${job2.id}/rows`))
        .body as PageBody<ImportRowBody>;
      expect(
        rows.items.map((r) => [r.values.subOrderNo, r.status, r.action]),
      ).toEqual([
        ['SO-1', 'imported', 'update'],
        ['SO-2', 'imported', 'unchanged'],
        ['SO-4', 'imported', 'insert'],
      ]);
      const so1 = (await order(shop, 'SO-1')) as Order;
      expect([
        so1.currentStatus,
        so1.currentStatusObservedAt.toISOString(),
        so1.lastImportJobId,
      ]).toEqual(['DELIVERED', endOfDayIst('2026-10-20'), Number(job2.id)]);
      const so2 = (await order(shop, 'SO-2')) as Order;
      expect(so2.currentStatusObservedAt.toISOString()).toBe(
        endOfDayIst('2026-10-20'),
      );
      expect(
        await OrderStatusEvent.count({
          where: { sellerAccountId: Number(shop) },
        }),
      ).toBe(6);
    });

    it('an EQUAL dataAsOf counts as "not older": the report updates the order', async () => {
      jobEqual = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-oct-2b.csv',
          [
            ORDER_HEADER,
            [
              'SO-2',
              '02-10-2026',
              'RTO',
              '2',
              'SKU-B',
              '250.50',
              'Maharashtra',
            ],
          ],
          '2026-10-20',
        ),
      );
      expect(jobEqual.dataAsOf).toBe(job2.dataAsOf);
      expect(jobEqual.preview.planned).toEqual(
        planned({ update: 1, statusEvents: 1 }),
      );
      const confirmed = await alice.post(`/imports/${jobEqual.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          updatedCount: 1,
          historyOnlyCount: 0,
        }),
      );
      const so2 = (await order(shop, 'SO-2')) as Order;
      expect([so2.currentStatus, so2.lastImportJobId]).toEqual([
        'RTO',
        Number(jobEqual.id),
      ]);
      expect(
        await OrderStatusEvent.count({
          where: { sellerAccountId: Number(shop) },
        }),
      ).toBe(7);
    });

    it('older report: history only — its own count; current status and values unchanged', async () => {
      const job3 = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-early.csv',
          [
            ORDER_HEADER,
            ['SO-1', '01-10-2026', 'PENDING', '1', 'SKU-A', '1.00', 'Gujarat'],
            ['SO-3', '03-10-2026', 'PENDING', '1', 'SKU-A', '499', 'Gujarat'],
          ],
          '2026-10-05',
        ),
      );
      expect(job3.preview.planned).toEqual(
        planned({ historyOnly: 2, statusEvents: 2 }),
      );
      expect(job3.preview.sampleRows.map((r) => r.action)).toEqual([
        'status_event',
        'status_event',
      ]);
      const confirmed = await alice.post(`/imports/${job3.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          historyOnlyCount: 2,
        }),
      );
      const so1 = (await order(shop, 'SO-1')) as Order;
      expect([so1.currentStatus, so1.supplierListedPrice]).toEqual([
        'DELIVERED',
        '499.00',
      ]);
      expect(await statusHistory(so1.id)).toEqual([
        ['PENDING', endOfDayIst('2026-10-05'), Number(job3.id)],
        ['SHIPPED', endOfDayIst('2026-10-10'), Number(job1.id)],
        ['DELIVERED', endOfDayIst('2026-10-20'), Number(job2.id)],
      ]);
      expect(
        await OrderStatusEvent.count({
          where: { sellerAccountId: Number(shop) },
        }),
      ).toBe(9);

      const list = (
        await alice.get(`/accounts/${shop}/imports?page=1&pageSize=2`)
      ).body as PageBody<ImportBody>;
      expect(list.total).toBe(4);
      expect(list.items.map((i) => i.id)).toEqual([job3.id, jobEqual.id]);
      const page2 = (
        await alice.get(`/accounts/${shop}/imports?page=2&pageSize=2`)
      ).body as PageBody<ImportBody>;
      expect(page2.items.map((i) => i.id)).toEqual([job2.id, job1.id]);
    });

    it('list / rows queries are allowlisted', async () => {
      expectError(
        await alice.get(`/accounts/${shop}/imports?pageSize=101`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(`/accounts/${shop}/imports?page=0`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(`/accounts/${shop}/imports?sort=id`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(`/imports/${job1.id}/rows?status=bogus`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(await alice.get('/imports/abc'), 400, 'VALIDATION_ERROR');
    });

    it('the same file is accepted for a different account', async () => {
      const second = await createAccount('Second shop');
      const job = await uploadOk(
        uploadCsv(alice, second, 'orders-oct.csv', file1),
      );
      expect(job.status).toBe('previewed');
      const confirmed = await alice.post(`/imports/${job.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({ status: 'completed', insertedCount: 3 }),
      );
      expect(
        await Order.count({ where: { sellerAccountId: Number(second) } }),
      ).toBe(3);
    });
  });

  describe('row errors and the partial-import policy', () => {
    it('error rows need skipErrorRows: 409 without, success with; skipped rows recorded', async () => {
      const job = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-errors.csv',
          [
            ORDER_HEADER,
            ['SO-5', '06-10-2026', 'SHIPPED', '1', 'SKU-A', '499', 'Goa'],
            ['SO-6', '10/25/2026', 'SHIPPED', '0', 'SKU-A', '1,23', 'Goa'],
            ['SO-5\u200b', '06-10-2026', 'RTO', '1', 'SKU-A', '499', 'Goa'],
          ],
          '2026-10-21',
        ),
      );
      expect([job.totalRows, job.validRows, job.errorRows]).toEqual([3, 1, 2]);
      const errors = (await alice.get(`/imports/${job.id}/errors`))
        .body as PageBody<ImportRowBody>;
      expect(
        errors.items.map((r) => [
          r.rowNumber,
          r.status,
          r.action,
          r.errors.map((e) => e.field),
        ]),
      ).toEqual([
        [3, 'error', null, ['orderDate', 'quantity', 'supplierListedPrice']],
        // "SO-5" + a zero-width space is the same sub-order as row 2.
        [4, 'error', null, ['subOrderNo']],
      ]);
      expect(errors.items[0].errors[2].reason).toBe(
        '"Supplier Listed Price (Incl. GST + Commission)" is not a valid amount',
      );

      const refused = await alice.post(`/imports/${job.id}/confirm`, {});
      expect(expectError(refused, 409, 'CONFLICT').details).toEqual([
        {
          field: 'skipErrorRows',
          reasons: [
            'Confirm with skipErrorRows: true to import the valid rows and skip the rows with errors',
          ],
        },
      ]);
      const done = await alice.post(`/imports/${job.id}/confirm`, {
        skipErrorRows: true,
      });
      expect(done.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 1,
          errorRows: 2,
        }),
      );
      const skipped = (
        await alice.get(`/imports/${job.id}/rows?status=skipped`)
      ).body as PageBody<ImportRowBody>;
      expect(skipped.items.map((r) => r.rowNumber)).toEqual([3, 4]);
    });

    it('zero valid rows → preview offers only cancel, confirm is 409; cancel deletes the staged rows but keeps the job', async () => {
      const job = await uploadOk(
        uploadCsv(alice, shop, 'orders-bad.csv', [
          ORDER_HEADER,
          ['SO-8', 'yesterday', 'SHIPPED', '1', 'SKU-A', '1', 'Goa'],
        ]),
      );
      expect([job.validRows, job.errorRows, job.allowedActions]).toEqual([
        0,
        1,
        ['cancel'],
      ]);
      const refused = await alice.post(`/imports/${job.id}/confirm`, {
        skipErrorRows: true,
      });
      expect(expectError(refused, 409, 'CONFLICT').message).toBe(
        'The file has no valid rows to import.',
      );

      const cancelled = await alice.post(`/imports/${job.id}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          totalRows: 1,
          errorRows: 1,
          allowedActions: [],
        }),
      );
      expect(
        await ImportRow.count({ where: { importJobId: Number(job.id) } }),
      ).toBe(0);
      expect(
        (
          (await alice.get(`/imports/${job.id}/errors`))
            .body as PageBody<ImportRowBody>
        ).total,
      ).toBe(0);
      expect((await alice.get(`/imports/${job.id}`)).body).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          preview: expect.objectContaining({ sampleRows: [] }) as unknown,
        }),
      );
      expect(await auditOf(job.id)).toEqual([
        expect.objectContaining({
          action: 'import.cancelled',
          beforeData: { status: 'previewed' },
          afterData: { status: 'cancelled', stagedRowsDeleted: 1 },
        }),
      ]);
      expectError(
        await alice.post(`/imports/${job.id}/cancel`),
        409,
        'CONFLICT',
      );
    });
  });

  describe('file-level rejections and limits: 4xx and no job created', () => {
    let before: number;

    beforeEach(async () => {
      before = await jobCount(shop);
    });

    afterEach(async () => {
      expect(await jobCount(shop)).toBe(before);
    });

    it('missing required header → 422 PARSE_ERROR naming the column', async () => {
      const res = await uploadCsv(alice, shop, 'orders.csv', [
        ['Sub Order No', 'Order Date', 'Quantity'],
        ['SO-9', '01-10-2026', '1'],
      ]);
      expect(expectError(res, 422, 'PARSE_ERROR').details).toEqual([
        {
          field: 'columns',
          reasons: [
            'Missing required column "Reason for Credit Entry" (also accepted: "Order Status", "Status")',
          ],
        },
      ]);
    });

    it('wrong extension, non-UTF-8 bytes, a ZIP named .csv and a non-workbook .xlsx → 422', async () => {
      expect(
        expectError(
          await send(alice, shop, {
            name: 'orders.txt',
            content: csv([ORDER_HEADER]),
          }),
          422,
          'PARSE_ERROR',
        ).details?.[0],
      ).toEqual({
        field: 'file',
        reasons: [
          'Unsupported file type: upload the orders report as .csv or the settlement workbook as .xlsx',
        ],
      });
      const latin1 = Buffer.from(
        'Sub Order No,Order Date,Status,Quantity\r\nSO-9,01-10-2026,Livr\xe9,1\r\n',
        'latin1',
      );
      expect(
        expectError(
          await send(
            alice,
            shop,
            { name: 'orders.csv', content: latin1 },
            { dataAsOf: '2026-10-10' },
          ),
          422,
          'PARSE_ERROR',
        ).details?.[0].reasons[0],
      ).toMatch(/not UTF-8/);
      expectError(
        await send(alice, shop, {
          name: 'orders.csv',
          content: notAWorkbookZip(),
        }),
        422,
        'PARSE_ERROR',
      );
      expect(
        expectError(
          await send(alice, shop, {
            name: 'payments.xlsx',
            content: notAWorkbookZip(),
          }),
          422,
          'PARSE_ERROR',
        ).details?.[0],
      ).toEqual({
        field: 'file',
        reasons: ['The workbook could not be read: is it a valid .xlsx file?'],
      });
    });

    it(`more than IMPORT_MAX_ROWS (${MAX_ROWS}) data rows, or more than ${MAX_ROWS} + 1000 lines → 422`, async () => {
      const rows: Cell[][] = [ORDER_HEADER];
      for (let i = 0; i <= MAX_ROWS; i++)
        rows.push([`BULK-${i}`, '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa']);
      expect(
        expectError(
          await uploadCsv(alice, shop, 'big.csv', rows),
          422,
          'PARSE_ERROR',
        ).details,
      ).toEqual([
        {
          field: 'file',
          reasons: [
            `The file has more than ${MAX_ROWS} data rows: split it into smaller date ranges`,
          ],
        },
      ]);
      const blankLines = `${ORDER_HEADER.join(',')}\n${'\n'.repeat(MAX_ROWS + 1000)}`;
      const lines = await send(
        alice,
        shop,
        { name: 'blank.csv', content: blankLines },
        { dataAsOf: '2026-10-10' },
      );
      expect(
        expectError(lines, 422, 'PARSE_ERROR').details?.[0].reasons,
      ).toEqual([
        `The file has more than ${MAX_ROWS + 1000} rows or lines (blank ones included): split it into smaller date ranges`,
      ]);
    });

    it('a large but small-enough workbook is stopped by the streaming row cap', async () => {
      const rows: Cell[][] = [['Deduction Date', 'Total Ads Cost']];
      for (let i = 0; i < 2000; i++) rows.push(['2026-10-01', -1]);
      const file = await workbook([{ name: 'Ads Cost', rows }]);
      expect(file.length).toBeLessThan(1024 * 1024);
      const res = await send(alice, shop, { name: 'ads.xlsx', content: file });
      expect(expectError(res, 422, 'PARSE_ERROR').details).toEqual([
        {
          field: 'file',
          reasons: [
            `The file has more than ${MAX_ROWS} data rows: split it into smaller date ranges`,
          ],
        },
      ]);
    });

    it('a file over IMPORT_MAX_FILE_MB (1 MB here) → 413', async () => {
      const big = `${ORDER_HEADER.join(',')}\r\n${'x'.repeat(1024 * 1024 + 10)}`;
      const res = await send(
        alice,
        shop,
        { name: 'orders.csv', content: big },
        { dataAsOf: '2026-10-10' },
      );
      expect(expectError(res, 413, 'PAYLOAD_TOO_LARGE').message).toBe(
        'The file is larger than the 1 MB limit.',
      );
    });

    it('a zip-bomb-like workbook (61 MB of zeros in ~60 KB) → 422 before any XML is read', async () => {
      const bomb = zeroBombXlsx(61 * 1024 * 1024);
      expect(bomb.length).toBeLessThan(1024 * 1024);
      const res = await send(alice, shop, {
        name: 'payments.xlsx',
        content: bomb,
      });
      expect(expectError(res, 422, 'PARSE_ERROR').details).toEqual([
        {
          field: 'file',
          reasons: [
            'The workbook expands to more than 60 MB and is refused as unsafe',
          ],
        },
      ]);
    }, 60_000);

    it('workbook structure attacks are refused at once: aliased sheets, an empty cell at column XFD, a bad character reference', async () => {
      const header = rowXml(1, {
        A1: 'Sub Order No',
        B1: 'Transaction ID',
        C1: 'Payment Date',
        D1: 'Final Settlement Amount',
      });
      const data = header + rowXml(2, { A2: 'SO-1', C2: '2026-10-12', D2: 5 });
      const onePart = [{ id: 'rId1', target: 'worksheets/sheet1.xml' }];
      const reasonsOf = async (name: string, content: Buffer) =>
        expectError(
          await send(alice, shop, { name, content }),
          422,
          'PARSE_ERROR',
        ).details?.[0].reasons;

      // 300 names ("Order Payments", "Order Payments.", …) over ONE part: used to import the row 300 times.
      const aliased = rawWorkbook(
        Array.from({ length: 300 }, (_, k) => ({
          name: `Order Payments${'.'.repeat(k)}`,
          rid: 'rId1',
        })),
        onePart,
        { 'xl/worksheets/sheet1.xml': data },
      );
      let started = Date.now();
      expect(await reasonsOf('aliased.xlsx', aliased)).toEqual([
        'The workbook has more than 50 sheets',
      ]);
      const twoNames = rawWorkbook(
        [
          { name: 'Order Payments', rid: 'rId1' },
          { name: 'Ads Cost', rid: 'rId1' },
        ],
        onePart,
        { 'xl/worksheets/sheet1.xml': data },
      );
      expect(await reasonsOf('two-names.xlsx', twoNames)).toEqual([
        'Sheets "Order Payments" and "Ads Cost" point to the same data: this workbook is not supported',
      ]);
      expect(Date.now() - started).toBeLessThan(5000);

      // 50,000 rows each holding an empty string at column XFD (took minutes before): rejected at row 2.
      const farRight = [header];
      for (let r = 2; r <= 50_000; r++)
        farRight.push(rowXml(r, { [`XFD${r}`]: '' }));
      const wide = rawWorkbook(
        [{ name: 'Order Payments', rid: 'rId1' }],
        onePart,
        {
          'xl/worksheets/sheet1.xml': farRight.join(''),
        },
      );
      expect(wide.length).toBeLessThan(1024 * 1024);
      started = Date.now();
      expect(await reasonsOf('wide.xlsx', wide)).toEqual([
        'A row uses more than 200 columns: this does not look like a Meesho report',
      ]);
      expect(Date.now() - started).toBeLessThan(5000);

      // A sheet name with &#x110000; (not a character) used to be a 500.
      const badName = rawWorkbook(
        [{ name: 'Order Payments&#x110000;', rid: 'rId1' }],
        onePart,
        { 'xl/worksheets/sheet1.xml': data },
      );
      expect(await reasonsOf('bad-name.xlsx', badName)).toEqual([
        'The workbook could not be read: is it a valid .xlsx file?',
      ]);
    }, 60_000);

    it('dataAsOf: required for orders CSV, date only, not after today (India), refused for workbooks → 400', async () => {
      const rows = [
        ORDER_HEADER,
        ['SO-9', '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
      ];
      expect(
        expectError(
          await uploadCsv(alice, shop, 'o.csv', rows, null),
          400,
          'VALIDATION_ERROR',
        ).details,
      ).toEqual([
        {
          field: 'dataAsOf',
          reasons: [
            'dataAsOf is required for orders CSV files: the day (YYYY-MM-DD) you downloaded the report from Meesho',
          ],
        },
      ]);
      expect(
        expectError(
          await uploadCsv(alice, shop, 'o.csv', rows, '2026-10-25T10:00:00Z'),
          400,
          'VALIDATION_ERROR',
        ).details,
      ).toEqual([
        {
          field: 'dataAsOf',
          reasons: ['dataAsOf must be a date in the form YYYY-MM-DD'],
        },
      ]);
      expect(
        expectError(
          await uploadCsv(alice, shop, 'o.csv', rows, '2999-01-01'),
          400,
          'VALIDATION_ERROR',
        ).details,
      ).toEqual([
        {
          field: 'dataAsOf',
          reasons: ['dataAsOf must not be after today (India time)'],
        },
      ]);
      expectError(
        await uploadCsv(alice, shop, 'o.csv', rows, '2026-10-10', {
          unknown: 'x',
        }),
        400,
        'VALIDATION_ERROR',
      );
      const xlsx = await workbook([
        {
          name: 'Ads Cost',
          rows: [
            ['Date', 'Ads Cost'],
            ['2026-10-01', 5],
          ],
        },
      ]);
      const wbRes = await send(
        alice,
        shop,
        { name: 'p.xlsx', content: xlsx },
        { dataAsOf: '2026-10-01' },
      );
      expect(expectError(wbRes, 400, 'VALIDATION_ERROR').details).toEqual([
        {
          field: 'dataAsOf',
          reasons: ['dataAsOf applies to orders CSV files only'],
        },
      ]);
    });

    it('no file or a wrong file field → 400; a disabled account → 409', async () => {
      const noFile = await alice.post(
        `/accounts/${shop}/imports`,
        { dataAsOf: '2026-10-01' },
        {
          headers: { [TEST_CLIENT_IP_HEADER]: freshIp() },
        },
      );
      expect(expectError(noFile, 400, 'VALIDATION_ERROR').details).toEqual([
        {
          field: 'file',
          reasons: ['A file is required (multipart field "file")'],
        },
      ]);
      expectError(
        await send(alice, shop, {
          name: 'orders.csv',
          content: 'a',
          fieldName: 'document',
        }),
        400,
        'VALIDATION_ERROR',
      );
      const res = await uploadCsv(alice, disabled, 'o.csv', [
        ORDER_HEADER,
        ['X', '01-10-2026', 'S', '1', 'S', '1', 'G'],
      ]);
      expectError(res, 409, 'CONFLICT');
      expect(await jobCount(disabled)).toBe(0);
    });

    it('more than 20 uploads per minute from one IP → 429 RATE_LIMITED', async () => {
      const ip = '10.250.0.1';
      for (let i = 0; i < 20; i++) {
        const res = await send(
          alice,
          shop,
          { name: 'x.txt', content: 'a' },
          {},
          { ip },
        );
        expect(res.status).toBe(422);
      }
      const limited = await send(
        alice,
        shop,
        { name: 'x.txt', content: 'a' },
        {},
        { ip },
      );
      expectError(limited, 429, 'RATE_LIMITED');
      expect(limited.headers['retry-after']).toEqual(expect.any(String));
      // Another IP is not affected.
      expect(
        (await send(alice, shop, { name: 'x.txt', content: 'a' })).status,
      ).toBe(422);
    });

    it('while 2 uploads are being parsed, another is refused with 429 "Imports are busy"', async () => {
      const limiter = ctx.app.get(ImportParseLimiter);
      const releases: (() => void)[] = [];
      const holds = [1, 2].map(() =>
        limiter.run(
          () => new Promise<void>((resolve) => releases.push(resolve)),
        ),
      );
      try {
        const res = await uploadCsv(alice, shop, 'busy.csv', [
          ORDER_HEADER,
          ['SO-B', '01-10-2026', 'S', '1', 'S', '1', 'G'],
        ]);
        expect(expectError(res, 429, 'RATE_LIMITED').message).toBe(
          'Imports are busy, try again in a moment',
        );
      } finally {
        releases.forEach((release) => release());
        await Promise.all(holds);
      }
    });
  });

  describe('GET /imports/config', () => {
    it('returns the upload limits to a signed-in user; 401 without a session', async () => {
      const res = await alice.get('/imports/config');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ maxFileMb: 1, maxRows: MAX_ROWS });
      expectError(
        await new TestClient(ctx.server).get('/imports/config'),
        401,
        'UNAUTHORIZED',
      );
    });
  });

  describe('settlement workbook (imported by Carol, a member)', () => {
    const paymentRows: Cell[][] = [
      [
        'SO-1',
        'TXN-1',
        new Date(Date.UTC(2026, 9, 1)),
        '08-10-2026',
        450,
        499,
        -49,
      ],
      ['SO-2', 'TXN-1', '02-10-2026', '08-10-2026', 230.5, 250.5, -20],
      // Same transaction ID AND same values: a genuinely separate entry, kept separate.
      ['SO-2', 'TXN-1', '02-10-2026', '08-10-2026', 230.5, 250.5, -20],
    ];

    it('preview lists recognised / ignored sheets; confirm stores every row, repeated transaction IDs separate', async () => {
      const file = await workbook([
        { name: 'Disclaimer', rows: [['Figures are provisional']] },
        {
          name: 'Order Payments',
          rows: [['Payments to date'], PAYMENT_HEADER, ...paymentRows],
        },
        {
          name: 'Ads Cost',
          rows: [
            ['Campaign ID', 'Deduction Date', 'Total Ads Cost'],
            ['CMP-1', '09/10/2026', -75],
          ],
        },
        { name: 'Notes', rows: [['anything']] },
      ]);
      const job = await uploadOk(
        send(carol, payments, { name: 'payments-oct.xlsx', content: file }),
      );
      expect(job).toEqual(
        expect.objectContaining({
          reportType: 'settlement_xlsx',
          status: 'previewed',
          totalRows: 4,
          validRows: 4,
          reportPeriodStart: '2026-10-08',
          reportPeriodEnd: '2026-10-09',
          allowedActions: ['confirm', 'cancel'],
        }),
      );
      expect(job.preview.planned).toEqual(planned({ insert: 4 }));
      expect(
        job.preview.sheets.map((s) => [s.name, s.entryType, s.ignored, s.rows]),
      ).toEqual([
        ['Disclaimer', null, true, 0],
        ['Order Payments', 'order_payment', false, 3],
        ['Ads Cost', 'ads_cost', false, 1],
        ['Notes', null, true, 0],
      ]);
      const confirmed = await carol.post(`/imports/${job.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 4,
          unchangedCount: 0,
          historyOnlyCount: 0,
        }),
      );
      const entries = await SettlementEntry.findAll({
        where: { sellerAccountId: Number(payments) },
        order: [['id', 'ASC']],
      });
      expect(
        entries.map((e) => [
          e.entryType,
          e.transactionId,
          e.subOrderNo,
          e.paymentDate,
          e.settlementAmount,
        ]),
      ).toEqual([
        ['order_payment', 'TXN-1', 'SO-1', '2026-10-08', '450.00'],
        ['order_payment', 'TXN-1', 'SO-2', '2026-10-08', '230.50'],
        ['order_payment', 'TXN-1', 'SO-2', '2026-10-08', '230.50'],
        ['ads_cost', 'CMP-1', null, '2026-10-09', '-75.00'],
      ]);
      expect(entries[0]).toEqual(
        expect.objectContaining({
          commissionAmount: '-49.00',
          orderId: null,
          isEstimate: false,
          fingerprintVersion: 2,
        }),
      );
      expect(new Set(entries.map((e) => e.entryFingerprint)).size).toBe(4);
      const [sum] = await ctx.sequelize.query<{ total: string }>(
        'SELECT CAST(SUM(settlement_amount) AS CHAR) AS total FROM settlement_entries WHERE seller_account_id = ?',
        { replacements: [payments], type: QueryTypes.SELECT },
      );
      // Hand total: 450.00 + 230.50 + 230.50 − 75.00 = 836.00
      expect(sum.total).toBe('836.00');
    });

    it('an overlapping workbook with header drift (optional column renamed, a 0 TCS column added) adds only new rows', async () => {
      const drifted = [
        'Sub Order No',
        'Transaction ID',
        'Order Date',
        'Payment Date',
        'Final Settlement Amount',
        'Total Sale Amount (Incl. Shipping & GST)',
        'Commission Paid',
        'TCS',
      ];
      const file = await workbook([
        {
          name: 'Order Payments',
          rows: [
            drifted,
            ...paymentRows.map((r) => [...r, 0]),
            ['SO-4', 'TXN-2', '05-10-2026', '12-10-2026', 90, 100, -10, null],
          ],
        },
        {
          name: 'Referral Payments',
          rows: [
            ['Payment Date', 'Net Referral Amount'],
            ['12/10/2026', '15'],
          ],
        },
      ]);
      const job = await uploadOk(
        send(carol, payments, { name: 'payments-oct-2.xlsx', content: file }),
      );
      expect(job.preview.planned).toEqual(planned({ insert: 2, unchanged: 3 }));
      expect(job.preview.sheets[0].ignoredColumns).toEqual(['Commission Paid']);
      const confirmed = await carol.post(`/imports/${job.id}/confirm`, {});
      expect(confirmed.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 2,
          updatedCount: 0,
          unchangedCount: 3,
        }),
      );
      expect(
        await SettlementEntry.count({
          where: { sellerAccountId: Number(payments) },
        }),
      ).toBe(6);
    });

    it('the same file previewed twice: the second confirm is refused by the active-file key (409)', async () => {
      const file = await workbook([
        {
          name: 'Ads Cost',
          rows: [
            ['Deduction Date', 'Ads Cost'],
            ['2026-10-20', -12.5],
          ],
        },
      ]);
      const first = await uploadOk(
        send(carol, payments, { name: 'ads.xlsx', content: file }),
      );
      const second = await uploadOk(
        send(carol, payments, { name: 'ads.xlsx', content: file }),
      );
      expect(
        (await carol.post(`/imports/${first.id}/confirm`, {})).status,
      ).toBe(200);
      const refused = await carol.post(`/imports/${second.id}/confirm`, {});
      expect(expectError(refused, 409, 'CONFLICT').details).toEqual([
        { field: 'file', reasons: [`Already imported as import ${first.id}`] },
      ]);
      expect((await ImportJob.findByPk(second.id))?.status).toBe('previewed');
      expect(
        await SettlementEntry.count({
          where: { sellerAccountId: Number(payments) },
        }),
      ).toBe(7);
      expect((await carol.post(`/imports/${second.id}/cancel`)).status).toBe(
        200,
      );
    });

    it('a failed settlement confirm rolls back (no entries) and retry succeeds', async () => {
      const file = await workbook([
        {
          name: 'Ads Cost',
          rows: [
            ['Deduction Date', 'Ads Cost'],
            ['2026-10-21', -1],
            ['2026-10-22', -2],
          ],
        },
      ]);
      const job = await uploadOk(
        send(carol, payments, { name: 'ads-2.xlsx', content: file }),
      );
      const spy = jest
        .spyOn(SettlementEntry, 'bulkCreate')
        .mockRejectedValueOnce(new Error('simulated'));
      const failed = await carol.post(`/imports/${job.id}/confirm`, {});
      spy.mockRestore();
      expectError(failed, 500, 'INTERNAL_ERROR');
      expect((await carol.get(`/imports/${job.id}`)).body).toEqual(
        expect.objectContaining({
          status: 'failed',
          allowedActions: ['retry', 'cancel'],
        }),
      );
      expect(
        await SettlementEntry.count({ where: { importJobId: Number(job.id) } }),
      ).toBe(0);
      const retried = await carol.post(`/imports/${job.id}/retry`);
      expect(retried.body).toEqual(
        expect.objectContaining({ status: 'completed', insertedCount: 2 }),
      );
      expect(
        await SettlementEntry.count({ where: { importJobId: Number(job.id) } }),
      ).toBe(2);
    });

    it('Compensation and Recovery: a Type column added later (flipping the derived entry type) does not duplicate the row', async () => {
      const before = await SettlementEntry.count({
        where: { sellerAccountId: Number(payments) },
      });
      const withoutType = await workbook([
        {
          name: 'Compensation and Recovery',
          rows: [
            ['Date', 'Amount'],
            ['2026-10-03', -50],
          ],
        },
      ]);
      const first = await uploadOk(
        send(carol, payments, { name: 'comp-1.xlsx', content: withoutType }),
      );
      expect(
        (await carol.post(`/imports/${first.id}/confirm`, {})).body,
      ).toEqual(
        expect.objectContaining({ status: 'completed', insertedCount: 1 }),
      );
      const withType = await workbook([
        {
          name: 'Compensation and Recovery',
          rows: [
            ['Date', 'Amount', 'Type'],
            ['2026-10-03', -50, 'Compensation reversal'],
          ],
        },
      ]);
      const second = await uploadOk(
        send(carol, payments, { name: 'comp-2.xlsx', content: withType }),
      );
      expect(second.preview.sampleRows[0].values.entryType).toBe(
        'compensation',
      );
      expect(second.preview.planned).toEqual(planned({ unchanged: 1 }));
      expect(
        (await carol.post(`/imports/${second.id}/confirm`, {})).body,
      ).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 0,
          unchangedCount: 1,
        }),
      );
      expect(
        await SettlementEntry.count({
          where: { sellerAccountId: Number(payments) },
        }),
      ).toBe(before + 1);
    });
  });

  describe('concurrent confirms of overlapping files (account lock + READ COMMITTED)', () => {
    it('orders: both complete, the order is inserted once and the newer status wins', async () => {
      const race = await createAccount('Race orders');
      const older = await uploadOk(
        uploadCsv(
          alice,
          race,
          'race-a.csv',
          [
            ORDER_HEADER,
            ['X-1', '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
            ['X-2', '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
          ],
          '2026-10-10',
        ),
      );
      const newer = await uploadOk(
        uploadCsv(
          alice,
          race,
          'race-b.csv',
          [
            ORDER_HEADER,
            ['X-1', '01-10-2026', 'DELIVERED', '1', 'S', '1', 'Goa'],
          ],
          '2026-10-20',
        ),
      );
      // Both previews planned an insert for X-1.
      expect([
        older.preview.planned.insert,
        newer.preview.planned.insert,
      ]).toEqual([2, 1]);

      const results = await Promise.all([
        alice.post(`/imports/${older.id}/confirm`, {}),
        alice.post(`/imports/${newer.id}/confirm`, {}),
      ]);
      expect(
        results.map((r) => [r.status, (r.body as ImportBody).status]),
      ).toEqual([
        [200, 'completed'],
        [200, 'completed'],
      ]);
      const bodies = results.map((r) => r.body as ImportBody);
      expect(bodies.reduce((n, b) => n + (b.insertedCount ?? 0), 0)).toBe(2);
      expect(
        bodies.reduce(
          (n, b) => n + (b.updatedCount ?? 0) + (b.historyOnlyCount ?? 0),
          0,
        ),
      ).toBe(1);
      const x1 = (await order(race, 'X-1')) as Order;
      expect([
        x1.currentStatus,
        x1.currentStatusObservedAt.toISOString(),
      ]).toEqual(['DELIVERED', endOfDayIst('2026-10-20')]);
      expect((await statusHistory(x1.id)).map((e) => e[0])).toEqual([
        'SHIPPED',
        'DELIVERED',
      ]);
      expect(
        await Order.count({ where: { sellerAccountId: Number(race) } }),
      ).toBe(2);
    });

    it('settlements: both complete, shared rows are stored once (no duplicate-key 500)', async () => {
      const race = await createAccount('Race payments');
      const r1: Cell[] = ['R-1', 'T-1', null, '2026-10-08', 10];
      const r2: Cell[] = ['R-2', 'T-2', null, '2026-10-08', 20];
      const r3: Cell[] = ['R-3', 'T-3', null, '2026-10-09', 30];
      const header = PAYMENT_HEADER.slice(0, 5);
      const w1 = await uploadOk(
        send(alice, race, {
          name: 'w1.xlsx',
          content: await workbook([
            { name: 'Order Payments', rows: [header, r1, r2] },
          ]),
        }),
      );
      const w2 = await uploadOk(
        send(alice, race, {
          name: 'w2.xlsx',
          content: await workbook([
            { name: 'Order Payments', rows: [header, r1, r2, r3] },
          ]),
        }),
      );
      const results = await Promise.all([
        alice.post(`/imports/${w1.id}/confirm`, {}),
        alice.post(`/imports/${w2.id}/confirm`, {}),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const bodies = results.map((r) => r.body as ImportBody);
      expect(bodies.reduce((n, b) => n + (b.insertedCount ?? 0), 0)).toBe(3);
      expect(bodies.reduce((n, b) => n + (b.unchangedCount ?? 0), 0)).toBe(2);
      expect(
        await SettlementEntry.count({
          where: { sellerAccountId: Number(race) },
        }),
      ).toBe(3);
    });
  });

  describe('a failed confirm rolls everything back; retry succeeds', () => {
    it('DB failure mid-import → 500, job failed, nothing written; retry → completed', async () => {
      const job = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-late.csv',
          [
            ORDER_HEADER,
            ['SO-1', '01-10-2026', 'RTO', '1', 'SKU-A', '499.00', 'Gujarat'],
            ['SO-7', '07-10-2026', 'SHIPPED', '1', 'SKU-D', '10', 'Goa'],
          ],
          '2026-10-25',
        ),
      );
      const eventsBefore = await OrderStatusEvent.count({
        where: { sellerAccountId: Number(shop) },
      });
      // Orders are upserted first; the failure hits the status events, so the orders must roll back too.
      const spy = jest
        .spyOn(OrderStatusEvent, 'bulkCreate')
        .mockRejectedValueOnce(new Error('simulated database failure'));
      const failed = await alice.post(`/imports/${job.id}/confirm`, {});
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      expect(expectError(failed, 500, 'INTERNAL_ERROR').message).not.toContain(
        'simulated',
      );
      expect((await alice.get(`/imports/${job.id}`)).body).toEqual(
        expect.objectContaining({
          status: 'failed',
          failureMessage:
            'The import failed and nothing was saved. You can retry it.',
          insertedCount: null,
          allowedActions: ['retry', 'cancel'],
        }),
      );
      expect(await order(shop, 'SO-7')).toBeNull();
      expect((await order(shop, 'SO-1'))?.currentStatus).toBe('DELIVERED');
      expect(
        await OrderStatusEvent.count({
          where: { sellerAccountId: Number(shop) },
        }),
      ).toBe(eventsBefore);
      expectError(
        await alice.post(`/imports/${job.id}/confirm`, {}),
        409,
        'CONFLICT',
      );

      const retried = await alice.post(`/imports/${job.id}/retry`);
      expect(retried.body).toEqual(
        expect.objectContaining({
          status: 'completed',
          insertedCount: 1,
          updatedCount: 1,
          failureMessage: null,
          allowedActions: [],
        }),
      );
      expect((await order(shop, 'SO-1'))?.currentStatus).toBe('RTO');
      expect(
        await OrderStatusEvent.count({
          where: { sellerAccountId: Number(shop) },
        }),
      ).toBe(eventsBefore + 2);
      expectError(
        await alice.post(`/imports/${job.id}/retry`),
        409,
        'CONFLICT',
      );
      expectError(
        await alice.post(`/imports/${job.id}/cancel`),
        409,
        'CONFLICT',
      );
    });

    it('a run whose job is cancelled (or re-claimed) while it works rolls back and leaves the job alone', async () => {
      const job = await uploadOk(
        uploadCsv(
          alice,
          shop,
          'orders-claim-lost.csv',
          [
            ORDER_HEADER,
            ['SO-E', '07-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
          ],
          '2026-10-24',
        ),
      );
      const realFindAll = ImportRow.findAll.bind(ImportRow) as (
        options: unknown,
      ) => Promise<ImportRow[]>;
      // Inside the run's transaction, before any row is written, another request (a cancel or retry of
      // what looked like a stale run) takes the job over.
      const spy = jest
        .spyOn(ImportRow, 'findAll')
        .mockImplementationOnce(async (options: unknown) => {
          await ImportJob.update(
            { status: 'cancelled' },
            { where: { id: Number(job.id) } },
          );
          return realFindAll(options);
        });
      const res = await alice.post(`/imports/${job.id}/confirm`, {});
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      expectError(res, 500, 'INTERNAL_ERROR');
      // Not completed, not marked failed by the losing run, and nothing it wrote survived.
      expect((await ImportJob.findByPk(job.id))?.status).toBe('cancelled');
      expect(await order(shop, 'SO-E')).toBeNull();
      expect(
        await OrderStatusEvent.count({
          where: { importJobId: Number(job.id) },
        }),
      ).toBe(0);
    });
  });

  describe('a stale "importing" job (crashed run) may be retried or cancelled after 15 minutes', () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

    async function stuck(
      name: string,
      subOrderNo: string,
      confirmedMinutesAgo: number,
    ): Promise<ImportBody> {
      const job = await uploadOk(
        uploadCsv(
          alice,
          shop,
          name,
          [
            ORDER_HEADER,
            [subOrderNo, '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
          ],
          '2026-10-22',
        ),
      );
      await ImportJob.update(
        {
          status: 'importing',
          confirmedAt: minutesAgo(confirmedMinutesAgo),
          confirmedByUserId: Number(job.createdBy.id),
        },
        { where: { id: Number(job.id) } },
      );
      return job;
    }

    it('a recent importing job offers nothing; retry and cancel are 409', async () => {
      const job = await stuck('stale-0.csv', 'ST-0', 1);
      expect(
        ((await alice.get(`/imports/${job.id}`)).body as ImportBody)
          .allowedActions,
      ).toEqual([]);
      expectError(
        await alice.post(`/imports/${job.id}/retry`),
        409,
        'CONFLICT',
      );
      expectError(
        await alice.post(`/imports/${job.id}/cancel`),
        409,
        'CONFLICT',
      );
      // Release it for the cleanup of the run.
      await ImportJob.update(
        { status: 'failed' },
        { where: { id: Number(job.id) } },
      );
    });

    it('after 15 minutes: retry completes it', async () => {
      const job = await stuck('stale-1.csv', 'ST-1', 16);
      expect(
        ((await alice.get(`/imports/${job.id}`)).body as ImportBody)
          .allowedActions,
      ).toEqual(['retry', 'cancel']);
      const retried = await alice.post(`/imports/${job.id}/retry`);
      expect(retried.body).toEqual(
        expect.objectContaining({ status: 'completed', insertedCount: 1 }),
      );
      expect((await order(shop, 'ST-1'))?.currentStatus).toBe('SHIPPED');
    });

    it('after 15 minutes: cancel discards it and deletes its staged rows', async () => {
      const job = await stuck('stale-2.csv', 'ST-2', 30);
      const cancelled = await alice.post(`/imports/${job.id}/cancel`);
      expect(cancelled.body).toEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(
        await ImportRow.count({ where: { importJobId: Number(job.id) } }),
      ).toBe(0);
      expect(await order(shop, 'ST-2')).toBeNull();
    });
  });

  describe('tenancy and CSRF', () => {
    let previewed: ImportBody;

    beforeAll(async () => {
      previewed = await uploadOk(
        uploadCsv(alice, shop, 'orders-tenancy.csv', [
          ORDER_HEADER,
          ['SO-T', '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
        ]),
      );
    });

    it('Bob (another workspace) gets the same 404 as for a missing id on every route', async () => {
      const missingAccount = await bob.get('/accounts/999999999/imports');
      const missingImport = await bob.get('/imports/999999999');
      expectError(missingAccount, 404, 'NOT_FOUND');
      expectError(missingImport, 404, 'NOT_FOUND');
      const accountRoutes = [
        await bob.get(`/accounts/${shop}/imports`),
        await uploadCsv(bob, shop, 'x.csv', [
          ORDER_HEADER,
          ['B-1', '01-10-2026', 'X', '1', 'S', '1', 'G'],
        ]),
      ];
      for (const res of accountRoutes) {
        expect(withoutRequestId(res.body)).toEqual(
          withoutRequestId(missingAccount.body),
        );
      }
      const importRoutes = [
        await bob.get(`/imports/${previewed.id}`),
        await bob.get(`/imports/${previewed.id}/rows`),
        await bob.get(`/imports/${previewed.id}/errors`),
        await bob.post(`/imports/${previewed.id}/confirm`, {}),
        await bob.post(`/imports/${previewed.id}/retry`),
        await bob.post(`/imports/${previewed.id}/cancel`),
      ];
      for (const res of importRoutes) {
        expect(res.status).toBe(404);
        expect(withoutRequestId(res.body)).toEqual(
          withoutRequestId(missingImport.body),
        );
      }
      expect((await ImportJob.findByPk(previewed.id))?.status).toBe(
        'previewed',
      );
      expect(await ImportJob.count({ where: { createdByUserId: bobId } })).toBe(
        0,
      );
    });

    it('CSRF is enforced on the multipart upload and on confirm/cancel', async () => {
      const before = await jobCount(shop);
      const file = {
        name: 'c.csv',
        content: csv([
          ORDER_HEADER,
          ['SO-C', '01-10-2026', 'SHIPPED', '1', 'S', '1', 'Goa'],
        ]),
      };
      const fields = { dataAsOf: '2026-10-10' };
      expectError(
        await send(alice, shop, file, fields, { csrf: false }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await send(alice, shop, file, fields, { csrf: 'not-the-cookie-value' }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await send(alice, shop, file, fields, {
          origin: 'http://evil.example',
        }),
        403,
        'FORBIDDEN',
      );
      expect(await jobCount(shop)).toBe(before);
      expectError(
        await alice.post(
          `/imports/${previewed.id}/confirm`,
          {},
          { csrf: false },
        ),
        403,
        'FORBIDDEN',
      );
      expectError(
        await alice.post(`/imports/${previewed.id}/cancel`, undefined, {
          csrf: false,
        }),
        403,
        'FORBIDDEN',
      );
      expect((await ImportJob.findByPk(previewed.id))?.status).toBe(
        'previewed',
      );
    });

    it('without a session → 401', async () => {
      const anonymous = new TestClient(ctx.server);
      await anonymous.primeCsrf();
      expectError(
        await anonymous.get(`/accounts/${shop}/imports`),
        401,
        'UNAUTHORIZED',
      );
      expectError(
        await send(anonymous, shop, { name: 'o.csv', content: 'a' }),
        401,
        'UNAUTHORIZED',
      );
    });

    it('an account disabled after the upload: confirm is 409, allowedActions drops confirm, the job stays previewed', async () => {
      await SellerAccount.update(
        { status: 'disabled' },
        { where: { id: Number(shop) } },
      );
      try {
        expect(
          ((await alice.get(`/imports/${previewed.id}`)).body as ImportBody)
            .allowedActions,
        ).toEqual(['cancel']);
        expectError(
          await alice.post(`/imports/${previewed.id}/confirm`, {}),
          409,
          'CONFLICT',
        );
        expect((await ImportJob.findByPk(previewed.id))?.status).toBe(
          'previewed',
        );
      } finally {
        await SellerAccount.update(
          { status: 'active' },
          { where: { id: Number(shop) } },
        );
      }
    });
  });

  it('Swagger documents the multipart upload, the config route and the import routes', async () => {
    const res = await request(ctx.server).get('/api/docs-json').expect(200);
    const paths = (
      res.body as {
        paths: Record<
          string,
          Record<
            string,
            { requestBody?: { content?: Record<string, unknown> } }
          >
        >;
      }
    ).paths;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/accounts/{accountId}/imports',
        '/api/v1/imports/config',
        '/api/v1/imports/{importId}',
        '/api/v1/imports/{importId}/rows',
        '/api/v1/imports/{importId}/errors',
        '/api/v1/imports/{importId}/confirm',
        '/api/v1/imports/{importId}/retry',
        '/api/v1/imports/{importId}/cancel',
      ]),
    );
    expect(
      Object.keys(
        paths['/api/v1/accounts/{accountId}/imports'].post.requestBody
          ?.content ?? {},
      ),
    ).toEqual(['multipart/form-data']);
  });
});
