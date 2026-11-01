import { QueryTypes } from 'sequelize';
import request, { type Response } from 'supertest';
import { todayInIndia, addDays } from '../src/common/time/india-date';
import { SettlementEntry, WorkspaceMember } from '../src/database/models';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
  TEST_CLIENT_IP_HEADER,
} from './support/e2e-app';
import { csv, workbook, type Cell } from './support/import-fixtures';
import { API, type ErrorBody, TestClient } from './support/test-client';

const PASSWORD = 'correct horse battery';
/** Pinned for this suite: the unfiltered A1 settlements export (14 rows) is over it, every filtered one under. */
const REPORT_MAX_ROWS = 12;
const OCT = 'from=2026-10-01&to=2026-10-31';

interface Dashboard {
  scope: { kind: string; id: string; name: string };
  filters: {
    from: string;
    to: string;
    basis: string;
    statuses: string[];
    granularity: string;
  };
  orders: {
    count: number;
    units: number;
    statusCounts: { status: string; count: number }[];
    orderValueDiscounted: string | null;
    orderValueListed: string | null;
    pricesMissing: number;
  };
  settlements: {
    amount: string | null;
    count: number;
    undatedEntries: number;
    byType: { entryType: string; amount: string | null; count: number }[];
    components: Record<string, string | null>;
  };
  productCost: {
    known: string | null;
    knownExact: string | null;
    ordersKnown: number;
    ordersCostUnknown: number;
    ordersNoProduct: number;
    cancelledOrReturnedOrders: number;
    cancelledOrReturnedCost: string | null;
  };
  expenses: {
    amount: string | null;
    count: number;
    accountAmount: string | null;
    workspaceAmount: string | null;
  };
  contribution: {
    amount: string | null;
    complete: boolean;
    flags: {
      costUnknown: number;
      ordersWithoutSettlement: number;
      unmatchedSettlements: number;
      pricesMissing: number;
      cancelledOrReturned: number;
    };
    formula: string;
  };
  trend: {
    bucketStart: string;
    orders: number;
    orderValueDiscounted: string | null;
    settlementAmount: string | null;
    productCostKnown: string | null;
    expenses: string | null;
  }[];
  accounts?: {
    id: string;
    displayName: string;
    status: string;
    orders: number;
    orderValueDiscounted: string | null;
    settlementAmount: string | null;
    productCostKnown: string | null;
    expenses: string | null;
    contribution: string | null;
    complete: boolean;
    cancelledOrReturnedOrders: number;
  }[];
  generatedAt: string;
}

interface ListTotals {
  total: number;
  totals?: {
    settlementAmount?: string | null;
    amount?: string | null;
    count: number;
  };
  items: { productCost?: { state: string; total: string | null } }[];
}

/** Exact sum of 2-or-4-dp decimal strings (BigInt at 4 dp), for the consistency checks. */
function decimalSum(values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null);
  if (present.length === 0) return null;
  let total = 0n;
  for (const v of present) {
    const [int, frac = ''] = v.replace('-', '').split('.');
    const scaled = BigInt(int + frac.padEnd(4, '0'));
    total += v.startsWith('-') ? -scaled : scaled;
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(5, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
const at4 = (v: string) => decimalSum([v]);

/** Minimal RFC 4180 reader: rows separated by CRLF, quoted fields with doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) throw new Error('last row lacks CRLF');
  return rows;
}

const ORDER_CSV_HEADER = [
  'Order ID',
  'Sub Order No',
  'Order No',
  'Order Date',
  'Product Name',
  'SKU',
  'Size',
  'Quantity',
  'Customer State',
  'Supplier Listed Price (as reported)',
  'Supplier Discounted Price (as reported)',
  'Current Status',
  'Status Observed At (UTC)',
  'Settlement Match',
  'Settlement Entries',
  'Settlement Amount (as reported)',
  'First Payment Date',
  'Product ID',
  'Product Cost State',
  'Unit Cost',
  'Cost Effective From',
  'Product Cost Total',
  'Source Import ID',
  'Source Import File',
];
const SETTLEMENT_CSV_HEADER = [
  'Entry ID',
  'Entry Type',
  'Sheet',
  'Transaction ID',
  'Sub Order No',
  'Order Date (entry)',
  'Payment Date',
  'Settlement Amount (as reported)',
  'Sale Amount',
  'Return Amount',
  'Meesho Commission',
  'Shipping Charge',
  'TCS',
  'TDS',
  'Recovery',
  'Compensation',
  'Is Estimate',
  'Superseded By Entry ID',
  'Match State',
  'Match Method',
  'Matched Order ID',
  'Matched Order Sub Order No',
  'Matched Order Date',
  'Matched At (UTC)',
  'Matched By',
  'Auto Match Blocked',
  'Source Import ID',
  'Source Import File',
  'Created At (UTC)',
];
const EXPENSE_CSV_HEADER = [
  'Expense ID',
  'Expense Date',
  'Scope',
  'Seller Account ID',
  'Seller Account',
  'Category',
  'Category Label',
  'Description',
  'Amount (INR)',
  'Created By',
  'Created At (UTC)',
  'Updated At (UTC)',
];

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
const PAYMENT_HEADER = [
  'Sub Order No',
  'Transaction ID',
  'Order Date',
  'Payment Date',
  'Final Settlement Amount',
  'Total Sale Amount (Incl. Shipping & GST)',
  'Total Sale Return Amount (Incl. Shipping & GST)',
  'Meesho Commission (Incl. GST)',
  'Shipping Charge (Incl. GST)',
  'TCS',
  'TDS',
  'Recovery',
  'Compensation',
];
const _ = null;

/**
 * Dashboard and reports (Milestone 7) against meesho_test. Every row comes through the real endpoints
 * (orders CSV + settlement workbook imports, product costs, expenses); s11 is then marked superseded in SQL
 * (nothing in the app sets supersession yet). Hand-calculated fixture — workspace "Domain A" (owner Alice,
 * member Carol; Bob is a stranger):
 *
 * A1 "Shop One" orders (as of 31 Oct)            qty listed disc  SKU    cost on order date
 *   A-1 01-10 DELIVERED  2  500  450  SKU-A  100.0000 (from 01-09) × 2 = 200.0000
 *   A-2 03-10 DELIVERED  1  300  280  SKU-B  333.3333 (from 02-10)     = 333.3333
 *   A-3 05-10 RTO        1  500  450  SKU-A  120.0000 (from 05-10: the boundary day itself) = 120.0000
 *   A-4 10-10 SHIPPED    3  100   —   SKU-C  unknown (no cost)
 *   A-5 28-09 DELIVERED  1  300  280  SKU-B  unknown (before 02-10)
 *   A-6 12-10 DELIVERED  1  200  190  —      no_product (no SKU)
 *   A-7 20-10 DELIVERED  1  300  280  SKU-B  333.3333
 * A1 settlement entries                  order date  payment   amount  (sale, return, comm, ship, tcs, tds, rec, comp)
 *   s1  A-1 T1                           01-10       08-10      400.00 (900, —, −90, −50, −4.50, −9.00, —, —)
 *   s2  A-2 T2 (own order date 28-09!)   03-10       10-10      250.00 (280, —, −20, −10, —, —, —, 10.00)
 *   s3  A-3 T3                           05-10       12-10      400.00 (450, —, −40, −10)
 *   s4  A-3 T4                           05-10       20-10     −420.00 (—, −450, —, −20, —, —, −5.00)
 *   s5  A-5 T5                           28-09       06-10      260.00 (300)
 *   s6  A-7 T6                           20-10       07-11      270.00 (280, —, −10)
 *   s7  A-1 T7                           01-10       05-11      −15.00
 *   s8  X-9 T8 (no such order: unmatched)15-10       18-10       99.00
 *   s9  X-8 T9 (unmatched)               —           22-10       11.00
 *   s10 A-2 T10                          03-10       —            5.00
 *   s11 A-7 T11 SUPERSEDED by s6         20-10       25-10     1000.00 (never counted)
 *   s12 Ads Cost CMP-1 (account level)   —           14-10     −150.00
 *   s13 Referral (account level)         —           16-10       30.00
 *   s14 Recovery (account level)         —           19-10      −40.00
 *   s15 Compensation (account level)     —           25-09       25.00
 * A2 "Shop Two": B-1 02-10 DELIVERED 1×900 (listed 1000), B-2 15-10 CANCELLED 1×900; SKU-Z 500.5000 from 01-10;
 *   q1 B-1 09-10 800.00 (sale 900, comm −100), q2 B-2 17-10 0.00. A3 "Old Shop": disabled, no data.
 * Expenses: A1 E1 05-10 100.00, E2 25-10 1000.00 ("=1+1 bonus"), E3 30-09 50.00; A2 E4 15-10 200.00;
 *   workspace W1 10-10 300.00 ("+91 phone bill"), W2 15-09 75.00.
 *
 * October (2026-10-01..31)          A1 order basis | A1 payment basis | A2 (both) | workspace order | workspace payment
 *   orders / units                    6 / 9        |   4 / 5          |  2 / 2    |   8 / 11        |   6 / 7
 *   order value disc / listed  1650.00 / 1900.00   | 1460.00/1600.00  | 1800/2000 | 3450.00/3900.00 | 3260.00/3600.00
 *   pricesMissing                      1           |   0              |  0        |   1             |   0
 *   settlement amount / count    829.00 / 11       | 840.00 / 10      | 800.00/2  | 1629.00 / 13    | 1640.00 / 12
 *     order basis: s1 s7 s2 s10 s3 s4 s6 (orders in scope) + s8 (own order date) + s12 s13 s14 (payment date)
 *     payment basis: s1 s2 s3 s4 s5 s8 s9 s12 s13 s14
 *   undatedEntries                     1 (s9)      |   1 (s10)        |  0        |   1             |   1
 *   product cost known (exact)  986.67 (986.6666) | 653.33 (653.3333)| 1001.00   | 1987.67         | 1654.33
 *   known / unknown / no product     4 / 1 / 1     |  3 / 1 / 0       |  2/0/0    |  6 / 1 / 1      |  5 / 1 / 0
 *   expenses                         1100.00      | 1100.00          | 200.00    | 1600.00 (1300 accounts + 300 workspace)
 *   contribution                     −1257.67     | −913.33          | −401.00   | −1958.67        | −1614.33
 *   flags (cost, w/o settl, unmatched, prices) 2,2,1,1 | 1,0,2,0      | 0,0,0,0   | 2,2,1,1         | 1,0,2,0
 * Cancelled / returned (raw status contains CANCEL / RTO / RETURN; cost still deducted, contribution incomplete):
 *   A-3 RTO (120.00) and B-2 CANCELLED (500.50): A1 1 / 120.00 in both bases, A2 1 / 500.50, workspace 2 / 620.50.
 * Workspace B (Bob, a stranger): same sub order numbers and dates (A-1, A-2, A-9 in October), entries, costs and
 *   expenses — none of it may appear in workspace A's numbers (every A total above stays exact).
 * A1 status=DELIVERED: order basis orders A-1 A-2 A-6 A-7 → 4 / 5 units / 1200.00 / settlement 849.00 (9) /
 *   cost 866.67 (3 known, 1 no product) / contribution −1117.67; payment basis order metrics A-1 A-2 A-5 → 3 /
 *   1010.00, settlements and costs unchanged (840.00, 653.33, −913.33).
 * A1 payment basis November: A-7 only (first payment 07-11; A-1's 05-11 entry is not its first) → 1 order,
 *   settlement s6 + s7 = 255.00, cost 333.33, contribution −78.33.
 */
describe('dashboard and reports (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;

  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  let carolId: string;
  let wsA: string;
  let wsB: string;
  let a1: string;
  let a2: string;
  let a3: string;
  let ipSeq = 0;
  const jobs: Record<string, string> = {};
  const products: Record<string, string> = {};
  /** A1 entries by label (s1..s15). */
  const s: Record<string, string> = {};

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

  function ok<T>(res: Response, status = 200): T {
    expect({
      status: res.status,
      body: res.status === status ? null : (res.body as unknown),
    }).toEqual({ status, body: null });
    return res.body as T;
  }

  function expectError(res: Response, status: number, code: string): void {
    expect({
      status: res.status,
      code: (res.body as ErrorBody).error?.code,
    }).toEqual({ status, code });
  }

  async function createAccount(name: string): Promise<string> {
    return ok<{ id: string }>(
      await alice.post(`/workspaces/${wsA}/accounts`, { displayName: name }),
      201,
    ).id;
  }

  async function importFile(
    accountId: string,
    name: string,
    content: Buffer | string,
    dataAsOf?: string,
    client: TestClient = alice,
  ): Promise<string> {
    ipSeq += 1;
    const uploaded = await client.upload(
      `/accounts/${accountId}/imports`,
      { name, content },
      dataAsOf ? { dataAsOf } : {},
      { headers: { [TEST_CLIENT_IP_HEADER]: `10.77.0.${ipSeq}` } },
    );
    const id = ok<{ id: string }>(uploaded, 201).id;
    const confirmed = ok<{ status: string }>(
      await client.post(`/imports/${id}/confirm`, {}),
    );
    expect(confirmed.status).toBe('completed');
    return id;
  }

  async function dashboard(
    path: string,
    query: string,
    client: TestClient = alice,
  ): Promise<Dashboard> {
    return ok<Dashboard>(await client.get(`${path}/dashboard?${query}`));
  }
  const accountDashboard = (accountId: string, query: string) =>
    dashboard(`/accounts/${accountId}`, query);

  async function list(path: string): Promise<ListTotals> {
    return ok<ListTotals>(await alice.get(path));
  }

  /** Raw download: the exact bytes (BOM included), whatever the content type. */
  async function download(
    client: TestClient,
    path: string,
    method: 'get' | 'head' = 'get',
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }> {
    const cookie = [...client.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const res = await request(ctx.server)
      [method](`${API}${path}`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((stream, callback) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return {
      status: res.status,
      headers: res.headers,
      // HEAD responses are never parsed (supertest leaves {}): no body at all.
      body: Buffer.isBuffer(res.body) ? res.body : Buffer.alloc(0),
    };
  }

  /** A CSV download → its rows (BOM and CRLF checked). */
  async function csvRows(
    client: TestClient,
    path: string,
  ): Promise<string[][]> {
    const res = await download(client, path);
    expect({
      status: res.status,
      body: res.status === 200 ? '' : res.body.toString(),
    }).toEqual({
      status: 200,
      body: '',
    });
    expect([...res.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = res.body.toString('utf8').slice(1);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    return parseCsv(text);
  }

  interface ExportAudit {
    action: string;
    entityType: string;
    entityId: string;
    actorUserId: number;
    workspaceId: number;
    sellerAccountId: number | null;
    afterData: {
      type: string;
      filters: Record<string, unknown>;
      rowCount: number;
    };
  }

  async function auditRows(): Promise<ExportAudit[]> {
    return ctx.sequelize.query<ExportAudit>(
      `SELECT action, entity_type AS entityType, entity_id AS entityId, actor_user_id AS actorUserId,
              workspace_id AS workspaceId, seller_account_id AS sellerAccountId, after_data AS afterData
       FROM audit_logs WHERE action = 'report.exported' AND workspace_id = ? ORDER BY id`,
      { replacements: [wsA], type: QueryTypes.SELECT },
    );
  }

  beforeAll(async () => {
    ctx = await createE2eApp({ reportMaxRows: REPORT_MAX_ROWS });
    const a = await register('alice', 'Domain A');
    const b = await register('bob', 'Domain B');
    const c = await register('carol', 'Carol own');
    alice = a.client;
    bob = b.client;
    carol = c.client;
    carolId = c.me.user.id;
    wsA = a.me.workspaces[0].id;
    wsB = b.me.workspaces[0].id;
    await WorkspaceMember.create({
      workspaceId: Number(wsA),
      userId: Number(carolId),
      role: 'member',
    });
    a1 = await createAccount('Shop One');
    a2 = await createAccount('Shop Two');
    a3 = await createAccount('Old Shop');
    ok(await alice.delete(`/accounts/${a3}`));

    const a1Orders: Cell[][] = [
      ORDER_HEADER,
      [
        'A-1',
        '01-10-2026',
        'DELIVERED',
        '2',
        'SKU-A',
        'Kurti, red "cotton"',
        '500',
        '450',
        'Gujarat',
      ],
      [
        'A-2',
        '03-10-2026',
        'DELIVERED',
        '1',
        'SKU-B',
        'Saree',
        '300',
        '280',
        'Kerala',
      ],
      [
        'A-3',
        '05-10-2026',
        'RTO',
        '1',
        'SKU-A',
        'Kurti, red "cotton"',
        '500',
        '450',
        'Delhi',
      ],
      [
        'A-4',
        '10-10-2026',
        'SHIPPED',
        '3',
        'SKU-C',
        '-Minus Kurti',
        '100',
        _,
        'Goa',
      ],
      [
        'A-5',
        '28-09-2026',
        'DELIVERED',
        '1',
        'SKU-B',
        'Saree',
        '300',
        '280',
        'Kerala',
      ],
      [
        'A-6',
        '12-10-2026',
        'DELIVERED',
        '1',
        _,
        '=HYPERLINK("x")',
        '200',
        '190',
        'Punjab',
      ],
      [
        'A-7',
        '20-10-2026',
        'DELIVERED',
        '1',
        'SKU-B',
        '@SUM(A1)',
        '300',
        '280',
        'Bihar',
      ],
    ];
    jobs.a1Orders = await importFile(
      a1,
      'orders-a1.csv',
      csv(a1Orders),
      '2026-10-31',
    );
    jobs.a2Orders = await importFile(
      a2,
      'orders-a2.csv',
      csv([
        ORDER_HEADER,
        [
          'B-1',
          '02-10-2026',
          'DELIVERED',
          '1',
          'SKU-Z',
          'Mug',
          '1000',
          '900',
          'Assam',
        ],
        [
          'B-2',
          '15-10-2026',
          'CANCELLED',
          '1',
          'SKU-Z',
          'Mug',
          '1000',
          '900',
          'Assam',
        ],
      ]),
      '2026-10-31',
    );

    for (const accountId of [a1, a2]) {
      const page = ok<{ items: { id: string; sku: string }[] }>(
        await alice.get(`/accounts/${accountId}/products`),
      );
      for (const p of page.items) products[p.sku] = p.id;
    }
    const addCost = async (
      sku: string,
      effectiveFrom: string,
      unitCost: string,
    ) =>
      ok(
        await alice.post(`/products/${products[sku]}/cost-history`, {
          effectiveFrom,
          unitCost,
        }),
        201,
      );
    await addCost('SKU-A', '2026-09-01', '100');
    await addCost('SKU-A', '2026-10-05', '120');
    await addCost('SKU-B', '2026-10-02', '333.3333');
    await addCost('SKU-Z', '2026-10-01', '500.5');

    const a1Book = await workbook([
      {
        name: 'Order Payments',
        rows: [
          PAYMENT_HEADER,
          [
            'A-1',
            'T1',
            '01-10-2026',
            '08-10-2026',
            400,
            900,
            _,
            -90,
            -50,
            -4.5,
            -9,
            _,
            _,
          ],
          [
            'A-2',
            'T2',
            '28-09-2026', // differs from A-2's order date (03-10): the order's date wins
            '10-10-2026',
            250,
            280,
            _,
            -20,
            -10,
            _,
            _,
            _,
            10,
          ],
          [
            'A-3',
            'T3',
            '05-10-2026',
            '12-10-2026',
            400,
            450,
            _,
            -40,
            -10,
            _,
            _,
            _,
            _,
          ],
          [
            'A-3',
            'T4',
            '05-10-2026',
            '20-10-2026',
            -420,
            _,
            -450,
            _,
            -20,
            _,
            _,
            -5,
            _,
          ],
          [
            'A-5',
            'T5',
            '28-09-2026',
            '06-10-2026',
            260,
            300,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
          ],
          [
            'A-7',
            'T6',
            '20-10-2026',
            '07-11-2026',
            270,
            280,
            _,
            -10,
            _,
            _,
            _,
            _,
            _,
          ],
          [
            'A-1',
            'T7',
            '01-10-2026',
            '05-11-2026',
            -15,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
          ],
          ['X-9', 'T8', '15-10-2026', '18-10-2026', 99, _, _, _, _, _, _, _, _],
          ['X-8', 'T9', _, '22-10-2026', 11, _, _, _, _, _, _, _, _],
          ['A-2', 'T10', '03-10-2026', _, 5, _, _, _, _, _, _, _, _],
          [
            'A-7',
            'T11',
            '20-10-2026',
            '25-10-2026',
            1000,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
          ],
        ],
      },
      {
        name: 'Ads Cost',
        rows: [
          ['Campaign ID', 'Deduction Date', 'Total Ads Cost'],
          ['CMP-1', '14-10-2026', -150],
        ],
      },
      {
        name: 'Referral Payments',
        rows: [
          ['Payment Date', 'Net Referral Amount'],
          ['16-10-2026', 30],
        ],
      },
      {
        name: 'Compensation and Recovery',
        rows: [
          ['Date', 'Amount', 'Type'],
          ['19-10-2026', -40, 'Recovery'],
          ['25-09-2026', 25, 'Compensation'],
        ],
      },
    ]);
    jobs.a1Payments = await importFile(a1, 'payments-a1.xlsx', a1Book);
    jobs.a2Payments = await importFile(
      a2,
      'payments-a2.xlsx',
      await workbook([
        {
          name: 'Order Payments',
          rows: [
            PAYMENT_HEADER,
            [
              'B-1',
              'U1',
              '02-10-2026',
              '09-10-2026',
              800,
              900,
              _,
              -100,
              _,
              _,
              _,
              _,
              _,
            ],
            [
              'B-2',
              'U2',
              '15-10-2026',
              '17-10-2026',
              0,
              _,
              _,
              _,
              _,
              _,
              _,
              _,
              _,
            ],
          ],
        },
      ]),
    );

    const entries = await SettlementEntry.findAll({
      where: { sellerAccountId: Number(a1) },
      order: [['id', 'ASC']],
    });
    expect(entries).toHaveLength(15);
    entries.forEach((entry, i) => (s[`s${i + 1}`] = String(entry.id)));
    expect(entries.map((x) => x.transactionId)).toEqual([
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'T8',
      'T9',
      'T10',
      'T11',
      'CMP-1',
      null,
      null,
      null,
    ]);
    await ctx.sequelize.query(
      'UPDATE settlement_entries SET superseded_by_entry_id = ? WHERE id = ?',
      { replacements: [s.s6, s.s11] },
    );

    const expense = async (path: string, body: object) =>
      ok(await alice.post(path, body), 201);
    await expense(`/accounts/${a1}/expenses`, {
      expenseDate: '2026-10-05',
      category: 'packaging',
      amount: '100',
    });
    await expense(`/accounts/${a1}/expenses`, {
      expenseDate: '2026-10-25',
      category: 'staff',
      amount: '1000',
      description: '=1+1 bonus',
    });
    await expense(`/accounts/${a1}/expenses`, {
      expenseDate: '2026-09-30',
      category: 'packaging',
      amount: '50',
    });
    await expense(`/accounts/${a2}/expenses`, {
      expenseDate: '2026-10-15',
      category: 'software_tools',
      amount: '200',
    });
    await expense(`/workspaces/${wsA}/expenses`, {
      expenseDate: '2026-10-10',
      category: 'rent_utilities',
      amount: '300',
      description: '+91 phone bill',
    });
    await expense(`/workspaces/${wsA}/expenses`, {
      expenseDate: '2026-09-15',
      category: 'other',
      amount: '75',
      description: 'Old stuff',
    });

    // Bob's workspace B: same sub order numbers and dates, its own costs and expenses. Never in A's numbers.
    const b1 = ok<{ id: string }>(
      await bob.post(`/workspaces/${wsB}/accounts`, {
        displayName: 'Bob Shop',
      }),
      201,
    ).id;
    await importFile(
      b1,
      'orders-b1.csv',
      csv([
        ORDER_HEADER,
        [
          'A-1',
          '01-10-2026',
          'DELIVERED',
          '5',
          'SKU-A',
          'Bob item',
          '800',
          '700',
          'Goa',
        ],
        [
          'A-2',
          '03-10-2026',
          'RTO',
          '1',
          'SKU-A',
          'Bob item',
          '800',
          '700',
          'Goa',
        ],
        [
          'A-9',
          '20-10-2026',
          'SHIPPED',
          '2',
          'SKU-A',
          'Bob item',
          '800',
          _,
          'Goa',
        ],
      ]),
      '2026-10-31',
      bob,
    );
    const bobProducts = ok<{ items: { id: string }[] }>(
      await bob.get(`/accounts/${b1}/products`),
    );
    ok(
      await bob.post(`/products/${bobProducts.items[0].id}/cost-history`, {
        effectiveFrom: '2026-01-01',
        unitCost: '7.77',
      }),
      201,
    );
    await importFile(
      b1,
      'payments-b1.xlsx',
      await workbook([
        {
          name: 'Order Payments',
          rows: [
            PAYMENT_HEADER,
            [
              'A-1',
              'T1',
              '01-10-2026',
              '08-10-2026',
              5000,
              9000,
              _,
              -500,
              _,
              _,
              _,
              _,
              _,
            ],
            ['A-2', 'T2', '03-10-2026', _, 77, _, _, _, _, _, _, _, _],
            [
              'X-9',
              'T8',
              '15-10-2026',
              '18-10-2026',
              99,
              _,
              _,
              _,
              _,
              _,
              _,
              _,
              _,
            ],
          ],
        },
        {
          name: 'Ads Cost',
          rows: [
            ['Campaign ID', 'Deduction Date', 'Total Ads Cost'],
            ['CMP-B', '14-10-2026', -999],
          ],
        },
      ]),
      undefined,
      bob,
    );
    ok(
      await bob.post(`/accounts/${b1}/expenses`, {
        expenseDate: '2026-10-05',
        category: 'packaging',
        amount: '777',
      }),
      201,
    );
    ok(
      await bob.post(`/workspaces/${wsB}/expenses`, {
        expenseDate: '2026-10-10',
        category: 'staff',
        amount: '888',
      }),
      201,
    );
  }, 120_000);

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  const NO_COMPONENTS = {
    sale: null,
    return: null,
    commission: null,
    shipping: null,
    tcs: null,
    tds: null,
    recovery: null,
    compensation: null,
  };
  const byType = (
    orderPayment: [string | null, number],
    ads: [string | null, number],
    referral: [string | null, number],
    compensation: [string | null, number],
    recovery: [string | null, number],
  ) =>
    [
      ['order_payment', ...orderPayment],
      ['ads_cost', ...ads],
      ['referral_payment', ...referral],
      ['compensation', ...compensation],
      ['recovery', ...recovery],
      ['other', null, 0],
    ].map(([entryType, amount, count]) => ({ entryType, amount, count }));

  describe('account dashboard: every field, both bases', () => {
    it('order_date basis (October)', async () => {
      const d = await accountDashboard(a1, `${OCT}&granularity=week`);
      expect(d.generatedAt).toEqual(expect.any(String));
      expect({ ...d, generatedAt: undefined, trend: undefined }).toEqual({
        scope: { kind: 'account', id: a1, name: 'Shop One' },
        filters: {
          from: '2026-10-01',
          to: '2026-10-31',
          basis: 'order_date',
          statuses: [],
          granularity: 'week',
        },
        orders: {
          count: 6,
          units: 9,
          statusCounts: [
            { status: 'DELIVERED', count: 4 },
            { status: 'RTO', count: 1 },
            { status: 'SHIPPED', count: 1 },
          ],
          orderValueDiscounted: '1650.00',
          orderValueListed: '1900.00',
          pricesMissing: 1,
        },
        settlements: {
          amount: '829.00',
          count: 11,
          undatedEntries: 1,
          byType: byType(
            ['989.00', 8],
            ['-150.00', 1],
            ['30.00', 1],
            [null, 0],
            ['-40.00', 1],
          ),
          components: {
            sale: '1910.00',
            return: '-450.00',
            commission: '-160.00',
            shipping: '-90.00',
            tcs: '-4.50',
            tds: '-9.00',
            recovery: '-5.00',
            compensation: '10.00',
          },
        },
        productCost: {
          known: '986.67',
          knownExact: '986.6666',
          ordersKnown: 4,
          ordersCostUnknown: 1,
          ordersNoProduct: 1,
          cancelledOrReturnedOrders: 1,
          cancelledOrReturnedCost: '120.00',
        },
        expenses: {
          amount: '1100.00',
          count: 2,
          accountAmount: '1100.00',
          workspaceAmount: null,
        },
        contribution: {
          amount: '-1257.67',
          complete: false,
          flags: {
            costUnknown: 2,
            ordersWithoutSettlement: 2,
            unmatchedSettlements: 1,
            pricesMissing: 1,
            cancelledOrReturned: 1,
          },
          formula: 'settlement amount − known product cost − expenses',
        },
      });
      // Weeks (ISO, Monday): 28-09 holds 01–04 Oct only (E3 of 30-09 is outside the range); 26-10 is empty.
      expect(d.trend).toEqual([
        {
          bucketStart: '2026-09-28',
          orders: 2,
          orderValueDiscounted: '730.00',
          settlementAmount: '640.00',
          productCostKnown: '533.33',
          expenses: null,
        },
        {
          bucketStart: '2026-10-05',
          orders: 2,
          orderValueDiscounted: '450.00',
          settlementAmount: '-20.00',
          productCostKnown: '120.00',
          expenses: '100.00',
        },
        {
          bucketStart: '2026-10-12',
          orders: 1,
          orderValueDiscounted: '190.00',
          settlementAmount: '-21.00',
          productCostKnown: null,
          expenses: null,
        },
        {
          bucketStart: '2026-10-19',
          orders: 1,
          orderValueDiscounted: '280.00',
          settlementAmount: '230.00',
          productCostKnown: '333.33',
          expenses: '1000.00',
        },
        {
          bucketStart: '2026-10-26',
          orders: 0,
          orderValueDiscounted: null,
          settlementAmount: null,
          productCostKnown: null,
          expenses: null,
        },
      ]);
    });

    it('payment_date basis (October): orders by FIRST payment date, settlements by payment date', async () => {
      const d = await accountDashboard(
        a1,
        `${OCT}&basis=payment_date&granularity=week`,
      );
      expect({
        filters: d.filters,
        orders: d.orders,
        settlements: d.settlements,
        productCost: d.productCost,
        expenses: d.expenses,
        contribution: d.contribution,
      }).toEqual({
        filters: {
          from: '2026-10-01',
          to: '2026-10-31',
          basis: 'payment_date',
          statuses: [],
          granularity: 'week',
        },
        orders: {
          count: 4,
          units: 5,
          statusCounts: [
            { status: 'DELIVERED', count: 3 },
            { status: 'RTO', count: 1 },
          ],
          orderValueDiscounted: '1460.00',
          orderValueListed: '1600.00',
          pricesMissing: 0,
        },
        settlements: {
          amount: '840.00',
          count: 10,
          undatedEntries: 1,
          byType: byType(
            ['1000.00', 7],
            ['-150.00', 1],
            ['30.00', 1],
            [null, 0],
            ['-40.00', 1],
          ),
          components: {
            sale: '1930.00',
            return: '-450.00',
            commission: '-150.00',
            shipping: '-90.00',
            tcs: '-4.50',
            tds: '-9.00',
            recovery: '-5.00',
            compensation: '10.00',
          },
        },
        productCost: {
          known: '653.33',
          knownExact: '653.3333',
          ordersKnown: 3,
          ordersCostUnknown: 1,
          ordersNoProduct: 0,
          cancelledOrReturnedOrders: 1,
          cancelledOrReturnedCost: '120.00',
        },
        expenses: {
          amount: '1100.00',
          count: 2,
          accountAmount: '1100.00',
          workspaceAmount: null,
        },
        contribution: {
          amount: '-913.33',
          complete: false,
          flags: {
            costUnknown: 1,
            ordersWithoutSettlement: 0,
            unmatchedSettlements: 2,
            pricesMissing: 0,
            cancelledOrReturned: 1,
          },
          formula: 'settlement amount − known product cost − expenses',
        },
      });
      // A-3 has entries in two weeks (12-10, 20-10): counted once, in the week of its FIRST payment.
      expect(d.trend).toEqual([
        {
          bucketStart: '2026-09-28',
          orders: 0,
          orderValueDiscounted: null,
          settlementAmount: null,
          productCostKnown: null,
          expenses: null,
        },
        {
          bucketStart: '2026-10-05',
          orders: 3,
          orderValueDiscounted: '1010.00',
          settlementAmount: '910.00',
          productCostKnown: '533.33',
          expenses: '100.00',
        },
        {
          bucketStart: '2026-10-12',
          orders: 1,
          orderValueDiscounted: '450.00',
          settlementAmount: '379.00',
          productCostKnown: '120.00',
          expenses: null,
        },
        {
          bucketStart: '2026-10-19',
          orders: 0,
          orderValueDiscounted: null,
          settlementAmount: '-449.00',
          productCostKnown: null,
          expenses: '1000.00',
        },
        {
          bucketStart: '2026-10-26',
          orders: 0,
          orderValueDiscounted: null,
          settlementAmount: null,
          productCostKnown: null,
          expenses: null,
        },
      ]);
    });

    it('an order is counted in ONE payment period: A-1 (05-11 adjustment) stays in October; November has A-7 only', async () => {
      const d = await accountDashboard(
        a1,
        'from=2026-11-01&to=2026-11-30&basis=payment_date',
      );
      expect({
        orders: d.orders.count,
        settlement: [d.settlements.amount, d.settlements.count],
        cost: d.productCost.known,
        expenses: d.expenses.amount,
        contribution: d.contribution.amount,
        granularity: d.filters.granularity,
      }).toEqual({
        orders: 1,
        settlement: ['255.00', 2],
        cost: '333.33',
        expenses: null,
        contribution: '-78.33',
        granularity: 'day',
      });
      expect(
        (
          await list(
            `/accounts/${a1}/orders?paymentFrom=2026-11-01&paymentTo=2026-11-30`,
          )
        ).total,
      ).toBe(1);
    });

    it('status filter: order basis narrows orders, their settlements and costs; payment basis only the order metrics', async () => {
      const order = await accountDashboard(
        a1,
        `${OCT}&status=DELIVERED&status=DELIVERED`,
      );
      expect({
        statuses: order.filters.statuses,
        orders: [
          order.orders.count,
          order.orders.units,
          order.orders.orderValueDiscounted,
          order.orders.orderValueListed,
        ],
        statusCounts: order.orders.statusCounts,
        settlement: [
          order.settlements.amount,
          order.settlements.count,
          order.settlements.undatedEntries,
        ],
        cost: [
          order.productCost.known,
          order.productCost.ordersKnown,
          order.productCost.ordersCostUnknown,
          order.productCost.ordersNoProduct,
        ],
        contribution: order.contribution.amount,
        flags: order.contribution.flags,
      }).toEqual({
        statuses: ['DELIVERED'],
        orders: [4, 5, '1200.00', '1300.00'],
        statusCounts: [{ status: 'DELIVERED', count: 4 }],
        settlement: ['849.00', 9, 1],
        cost: ['866.67', 3, 0, 1],
        contribution: '-1117.67',
        flags: {
          costUnknown: 1,
          ordersWithoutSettlement: 1,
          unmatchedSettlements: 1,
          pricesMissing: 0,
          cancelledOrReturned: 0,
        },
      });
      const payment = await accountDashboard(
        a1,
        `${OCT}&basis=payment_date&status=DELIVERED`,
      );
      expect({
        orders: [
          payment.orders.count,
          payment.orders.units,
          payment.orders.orderValueDiscounted,
        ],
        settlement: [payment.settlements.amount, payment.settlements.count],
        cost: payment.productCost.known,
        contribution: payment.contribution.amount,
      }).toEqual({
        orders: [3, 4, '1010.00'],
        settlement: ['840.00', 10],
        cost: '653.33',
        contribution: '-913.33',
      });
      // A status no order has: zero orders, null sums (not 0.00); account-level / unmatched entries remain.
      const none = await accountDashboard(a1, `${OCT}&status=delivered`);
      expect([
        none.orders.count,
        none.orders.orderValueDiscounted,
        none.productCost.known,
        none.settlements.amount,
      ]).toEqual([0, null, null, '-61.00']);
    });

    it('month and day buckets; default granularity day for 31 days; sums over a two-month range', async () => {
      const months = await accountDashboard(
        a1,
        'from=2026-09-01&to=2026-10-31&granularity=month',
      );
      expect(months.trend).toEqual([
        {
          bucketStart: '2026-09-01',
          orders: 1,
          orderValueDiscounted: '280.00',
          settlementAmount: '285.00',
          productCostKnown: null,
          expenses: '50.00',
        },
        {
          bucketStart: '2026-10-01',
          orders: 6,
          orderValueDiscounted: '1650.00',
          settlementAmount: '829.00',
          productCostKnown: '986.67',
          expenses: '1100.00',
        },
      ]);
      expect([
        months.orders.count,
        months.settlements.amount,
        months.productCost.known,
        months.expenses.amount,
      ]).toEqual([7, '1114.00', '986.67', '1150.00']);
      const days = await accountDashboard(a1, OCT);
      expect(days.filters.granularity).toBe('day');
      expect(days.trend).toHaveLength(31);
      expect(days.trend.slice(0, 2)).toEqual([
        {
          bucketStart: '2026-10-01',
          orders: 1,
          orderValueDiscounted: '450.00',
          settlementAmount: '385.00',
          productCostKnown: '200.00',
          expenses: null,
        },
        {
          bucketStart: '2026-10-02',
          orders: 0,
          orderValueDiscounted: null,
          settlementAmount: null,
          productCostKnown: null,
          expenses: null,
        },
      ]);
    });

    it('defaults: last 30 days ending today (India), order_date basis', async () => {
      const d = await accountDashboard(a1, '');
      const today = todayInIndia();
      expect(d.filters).toEqual({
        from: addDays(today, -29),
        to: today,
        basis: 'order_date',
        statuses: [],
        granularity: 'day',
      });
      expect(d.trend).toHaveLength(30);
    });

    it("A2: a zero settlement is 0.00; the CANCELLED order's cost is still deducted but makes it incomplete", async () => {
      for (const basis of ['order_date', 'payment_date']) {
        const d = await accountDashboard(a2, `${OCT}&basis=${basis}`);
        expect({
          orders: d.orders,
          settlements: d.settlements,
          productCost: d.productCost,
          expenses: d.expenses,
          contribution: d.contribution,
        }).toEqual({
          orders: {
            count: 2,
            units: 2,
            statusCounts: [
              { status: 'CANCELLED', count: 1 },
              { status: 'DELIVERED', count: 1 },
            ],
            orderValueDiscounted: '1800.00',
            orderValueListed: '2000.00',
            pricesMissing: 0,
          },
          settlements: {
            amount: '800.00',
            count: 2,
            undatedEntries: 0,
            byType: byType(
              ['800.00', 2],
              [null, 0],
              [null, 0],
              [null, 0],
              [null, 0],
            ),
            components: {
              ...NO_COMPONENTS,
              sale: '900.00',
              commission: '-100.00',
            },
          },
          productCost: {
            known: '1001.00',
            knownExact: '1001.0000',
            ordersKnown: 2,
            ordersCostUnknown: 0,
            ordersNoProduct: 0,
            cancelledOrReturnedOrders: 1,
            cancelledOrReturnedCost: '500.50',
          },
          expenses: {
            amount: '200.00',
            count: 1,
            accountAmount: '200.00',
            workspaceAmount: null,
          },
          contribution: {
            amount: '-401.00',
            complete: false,
            flags: {
              costUnknown: 0,
              ordersWithoutSettlement: 0,
              unmatchedSettlements: 0,
              pricesMissing: 0,
              cancelledOrReturned: 1,
            },
            formula: 'settlement amount − known product cost − expenses',
          },
        });
      }
      const zero = await accountDashboard(
        a2,
        'from=2026-10-17&to=2026-10-17&basis=payment_date',
      );
      expect([zero.settlements.amount, zero.settlements.count]).toEqual([
        '0.00',
        1,
      ]);
    });

    it('a disabled account with no data: zeros and nulls, never 0.00 for missing', async () => {
      const d = await accountDashboard(a3, OCT);
      expect({
        orders: d.orders,
        settlement: [
          d.settlements.amount,
          d.settlements.count,
          d.settlements.components,
        ],
        cost: d.productCost,
        expenses: d.expenses,
        contribution: [d.contribution.amount, d.contribution.complete],
        trendSums: d.trend.filter(
          (p) =>
            p.orders > 0 || p.settlementAmount !== null || p.expenses !== null,
        ),
      }).toEqual({
        orders: {
          count: 0,
          units: 0,
          statusCounts: [],
          orderValueDiscounted: null,
          orderValueListed: null,
          pricesMissing: 0,
        },
        settlement: [null, 0, NO_COMPONENTS],
        cost: {
          known: null,
          knownExact: null,
          ordersKnown: 0,
          ordersCostUnknown: 0,
          ordersNoProduct: 0,
          cancelledOrReturnedOrders: 0,
          cancelledOrReturnedCost: null,
        },
        expenses: {
          amount: null,
          count: 0,
          accountAmount: null,
          workspaceAmount: null,
        },
        contribution: [null, true],
        trendSums: [],
      });
    });
  });

  describe('workspace dashboard and the account comparison', () => {
    it('order_date basis: totals over every account + workspace-wide expenses; one row per account (disabled too)', async () => {
      const d = await dashboard(`/workspaces/${wsA}`, OCT, carol);
      expect({ ...d, generatedAt: undefined, trend: undefined }).toEqual({
        scope: { kind: 'workspace', id: wsA, name: 'Domain A' },
        filters: {
          from: '2026-10-01',
          to: '2026-10-31',
          basis: 'order_date',
          statuses: [],
          granularity: 'day',
        },
        orders: {
          count: 8,
          units: 11,
          statusCounts: [
            { status: 'DELIVERED', count: 5 },
            { status: 'CANCELLED', count: 1 },
            { status: 'RTO', count: 1 },
            { status: 'SHIPPED', count: 1 },
          ],
          orderValueDiscounted: '3450.00',
          orderValueListed: '3900.00',
          pricesMissing: 1,
        },
        settlements: {
          amount: '1629.00',
          count: 13,
          undatedEntries: 1,
          byType: byType(
            ['1789.00', 10],
            ['-150.00', 1],
            ['30.00', 1],
            [null, 0],
            ['-40.00', 1],
          ),
          components: {
            sale: '2810.00',
            return: '-450.00',
            commission: '-260.00',
            shipping: '-90.00',
            tcs: '-4.50',
            tds: '-9.00',
            recovery: '-5.00',
            compensation: '10.00',
          },
        },
        productCost: {
          known: '1987.67',
          knownExact: '1987.6666',
          ordersKnown: 6,
          ordersCostUnknown: 1,
          ordersNoProduct: 1,
          cancelledOrReturnedOrders: 2,
          cancelledOrReturnedCost: '620.50',
        },
        expenses: {
          amount: '1600.00',
          count: 4,
          accountAmount: '1300.00',
          workspaceAmount: '300.00',
        },
        contribution: {
          amount: '-1958.67',
          complete: false,
          flags: {
            costUnknown: 2,
            ordersWithoutSettlement: 2,
            unmatchedSettlements: 1,
            pricesMissing: 1,
            cancelledOrReturned: 2,
          },
          formula: 'settlement amount − known product cost − expenses',
        },
        accounts: [
          {
            id: a3,
            displayName: 'Old Shop',
            status: 'disabled',
            orders: 0,
            orderValueDiscounted: null,
            settlementAmount: null,
            productCostKnown: null,
            expenses: null,
            contribution: null,
            complete: true,
            cancelledOrReturnedOrders: 0,
          },
          {
            id: a1,
            displayName: 'Shop One',
            status: 'active',
            orders: 6,
            orderValueDiscounted: '1650.00',
            settlementAmount: '829.00',
            productCostKnown: '986.67',
            expenses: '1100.00',
            contribution: '-1257.67',
            complete: false,
            cancelledOrReturnedOrders: 1,
          },
          {
            id: a2,
            displayName: 'Shop Two',
            status: 'active',
            orders: 2,
            orderValueDiscounted: '1800.00',
            settlementAmount: '800.00',
            productCostKnown: '1001.00',
            expenses: '200.00',
            contribution: '-401.00',
            complete: false,
            cancelledOrReturnedOrders: 1,
          },
        ],
      });
      expect(d.trend).toHaveLength(31);
      expect(d.trend.find((p) => p.bucketStart === '2026-10-10')).toEqual({
        bucketStart: '2026-10-10',
        orders: 1,
        orderValueDiscounted: null, // A-4 has no discounted price: a gap, not 0.00
        settlementAmount: null,
        productCostKnown: null,
        expenses: '300.00', // W1 (workspace-wide)
      });
    });

    it('payment_date basis totals and rows', async () => {
      const d = await dashboard(
        `/workspaces/${wsA}`,
        `${OCT}&basis=payment_date`,
      );
      expect({
        orders: [
          d.orders.count,
          d.orders.units,
          d.orders.orderValueDiscounted,
          d.orders.orderValueListed,
          d.orders.pricesMissing,
        ],
        statusCounts: d.orders.statusCounts,
        settlements: [
          d.settlements.amount,
          d.settlements.count,
          d.settlements.undatedEntries,
        ],
        cost: [
          d.productCost.known,
          d.productCost.knownExact,
          d.productCost.ordersKnown,
          d.productCost.ordersCostUnknown,
          d.productCost.ordersNoProduct,
        ],
        expenses: d.expenses,
        contribution: [d.contribution.amount, d.contribution.flags],
        accounts: d.accounts?.map((a) => [
          a.displayName,
          a.orders,
          a.orderValueDiscounted,
          a.settlementAmount,
          a.productCostKnown,
          a.expenses,
          a.contribution,
          a.complete,
        ]),
      }).toEqual({
        orders: [6, 7, '3260.00', '3600.00', 0],
        statusCounts: [
          { status: 'DELIVERED', count: 4 },
          { status: 'CANCELLED', count: 1 },
          { status: 'RTO', count: 1 },
        ],
        settlements: ['1640.00', 12, 1],
        cost: ['1654.33', '1654.3333', 5, 1, 0],
        expenses: {
          amount: '1600.00',
          count: 4,
          accountAmount: '1300.00',
          workspaceAmount: '300.00',
        },
        contribution: [
          '-1614.33',
          {
            costUnknown: 1,
            ordersWithoutSettlement: 0,
            unmatchedSettlements: 2,
            pricesMissing: 0,
            cancelledOrReturned: 2,
          },
        ],
        accounts: [
          ['Old Shop', 0, null, null, null, null, null, true],
          [
            'Shop One',
            4,
            '1460.00',
            '840.00',
            '653.33',
            '1100.00',
            '-913.33',
            false,
          ],
          [
            'Shop Two',
            2,
            '1800.00',
            '800.00',
            '1001.00',
            '200.00',
            '-401.00',
            false,
          ],
        ],
      });
    });

    it('Σ account rows (+ workspace-wide expenses) = the workspace totals, for both bases and with a status filter', async () => {
      for (const query of [
        OCT,
        `${OCT}&basis=payment_date`,
        `${OCT}&status=DELIVERED`,
        'from=2026-09-01&to=2026-10-31',
      ]) {
        const d = await dashboard(`/workspaces/${wsA}`, query);
        const rows = d.accounts ?? [];
        const sum = (pick: (r: (typeof rows)[number]) => string | null) =>
          decimalSum(rows.map(pick));
        const total = (v: string | null) => (v === null ? null : at4(v));
        expect({
          orders: rows.reduce((n, r) => n + r.orders, 0),
          orderValue: sum((r) => r.orderValueDiscounted),
          settlement: sum((r) => r.settlementAmount),
          cost: sum((r) => r.productCostKnown),
          expenses: decimalSum([
            sum((r) => r.expenses),
            d.expenses.workspaceAmount,
          ]),
          contribution: decimalSum([
            sum((r) => r.contribution),
            d.expenses.workspaceAmount === null
              ? null
              : `-${d.expenses.workspaceAmount}`,
          ]),
        }).toEqual({
          orders: d.orders.count,
          orderValue: total(d.orders.orderValueDiscounted),
          settlement: total(d.settlements.amount),
          cost: total(d.productCost.known),
          expenses: total(d.expenses.amount),
          contribution: total(d.contribution.amount),
        });
      }
    });
  });

  it("a second workspace (Bob) in the same period has its own numbers, never in A's", async () => {
    // Bob: A-1 01-10 ×5, A-2 03-10 RTO ×1, A-9 20-10 ×2 (no price); SKU-A 7.7700; entries A-1 5000.00 (08-10),
    // A-2 77.00 (no payment date), X-9 99.00 (unmatched, own order date 15-10), Ads −999.00 (14-10);
    // expenses 777.00 (account) + 888.00 (workspace-wide).
    const b = await dashboard(`/workspaces/${wsB}`, OCT, bob);
    expect({
      orders: [b.orders.count, b.orders.units, b.orders.pricesMissing],
      settlement: [b.settlements.amount, b.settlements.count],
      cost: [
        b.productCost.known,
        b.productCost.cancelledOrReturnedOrders,
        b.productCost.cancelledOrReturnedCost,
      ],
      expenses: [b.expenses.amount, b.expenses.workspaceAmount],
      contribution: b.contribution.amount,
    }).toEqual({
      orders: [3, 8, 1],
      settlement: ['4177.00', 4],
      cost: ['62.16', 1, '7.77'],
      expenses: ['1665.00', '888.00'],
      contribution: '2449.84',
    });
    expectError(
      await alice.get(`/workspaces/${wsB}/dashboard`),
      404,
      'NOT_FOUND',
    );
  });

  describe('traceability: each dashboard number = the matching filtered list total', () => {
    it('orders (both bases, status, without settlement)', async () => {
      const order = await accountDashboard(a1, OCT);
      const payment = await accountDashboard(a1, `${OCT}&basis=payment_date`);
      const delivered = await accountDashboard(a1, `${OCT}&status=DELIVERED`);
      const pDelivered = await accountDashboard(
        a1,
        `${OCT}&basis=payment_date&status=DELIVERED`,
      );
      const pay = 'paymentFrom=2026-10-01&paymentTo=2026-10-31';
      expect([
        (await list(`/accounts/${a1}/orders?${OCT}`)).total,
        (await list(`/accounts/${a1}/orders?${pay}`)).total,
        (await list(`/accounts/${a1}/orders?${OCT}&status=DELIVERED`)).total,
        (await list(`/accounts/${a1}/orders?${pay}&status=DELIVERED`)).total,
        (await list(`/accounts/${a1}/orders?${OCT}&settlement=unmatched`))
          .total,
      ]).toEqual([
        order.orders.count,
        payment.orders.count,
        delivered.orders.count,
        pDelivered.orders.count,
        order.contribution.flags.ordersWithoutSettlement,
      ]);
      // Product cost: Σ of the listed orders' exact costs (state known).
      const exact = async (query: string) =>
        decimalSum(
          (await list(`/accounts/${a1}/orders?${query}&pageSize=100`)).items
            .filter((o) => o.productCost?.state === 'known')
            .map((o) => o.productCost?.total ?? null),
        );
      expect([await exact(OCT), await exact(pay)]).toEqual([
        at4(order.productCost.knownExact ?? ''),
        at4(payment.productCost.knownExact ?? ''),
      ]);
    });

    it('settlements (dateBasis on the list), unmatched and by type', async () => {
      const order = await accountDashboard(a1, OCT);
      const payment = await accountDashboard(a1, `${OCT}&basis=payment_date`);
      const totals = async (query: string) => {
        const page = await list(`/accounts/${a1}/settlements?${query}`);
        return [page.totals?.settlementAmount, page.totals?.count];
      };
      expect([
        await totals(`dateBasis=order_date&${OCT}`),
        await totals(`dateBasis=payment_date&${OCT}`),
        await totals(OCT), // the M5 default is still the payment date
      ]).toEqual([
        [order.settlements.amount, order.settlements.count],
        [payment.settlements.amount, payment.settlements.count],
        [payment.settlements.amount, payment.settlements.count],
      ]);
      expect([
        (
          await list(
            `/accounts/${a1}/settlements?dateBasis=order_date&${OCT}&match=unmatched`,
          )
        ).total,
        (await list(`/accounts/${a1}/settlements?${OCT}&match=unmatched`))
          .total,
      ]).toEqual([
        order.contribution.flags.unmatchedSettlements,
        payment.contribution.flags.unmatchedSettlements,
      ]);
      for (const t of order.settlements.byType) {
        expect(
          await totals(`dateBasis=order_date&${OCT}&entryType=${t.entryType}`),
        ).toEqual([t.amount, t.count]);
      }
      // Superseded s11 is in neither: only listed with includeSuperseded, and never in the totals.
      const withSuperseded = await list(
        `/accounts/${a1}/settlements?${OCT}&includeSuperseded=true`,
      );
      expect([
        withSuperseded.total,
        withSuperseded.totals?.count,
        withSuperseded.totals?.settlementAmount,
      ]).toEqual([11, 10, '840.00']);
    });

    it('expenses (account, workspace all, workspace-wide only)', async () => {
      const acc = await accountDashboard(a1, OCT);
      const ws = await dashboard(`/workspaces/${wsA}`, OCT);
      const totals = async (path: string) => {
        const page = await list(path);
        return [page.totals?.amount, page.totals?.count];
      };
      expect([
        await totals(`/accounts/${a1}/expenses?${OCT}`),
        await totals(`/workspaces/${wsA}/expenses?scope=all&${OCT}`),
        await totals(`/workspaces/${wsA}/expenses?scope=workspace&${OCT}`),
      ]).toEqual([
        [acc.expenses.amount, acc.expenses.count],
        [ws.expenses.amount, ws.expenses.count],
        [ws.expenses.workspaceAmount, 1],
      ]);
    });
  });

  describe('dashboard access and validation', () => {
    it('members read both dashboards; a stranger gets 404; no session → 401', async () => {
      expect((await carol.get(`/accounts/${a1}/dashboard?${OCT}`)).status).toBe(
        200,
      );
      expectError(
        await bob.get(`/accounts/${a1}/dashboard?${OCT}`),
        404,
        'NOT_FOUND',
      );
      expectError(
        await bob.get(`/workspaces/${wsA}/dashboard?${OCT}`),
        404,
        'NOT_FOUND',
      );
      expectError(
        await new TestClient(ctx.server).get(`/accounts/${a1}/dashboard`),
        401,
        'UNAUTHORIZED',
      );
    });

    it.each([
      ['to before from', 'from=2026-10-31&to=2026-10-01', 'to'],
      ['a range over 731 days', 'from=2024-10-30&to=2026-10-31', 'to'],
      ['a future from without to', 'from=2999-01-01', 'from'],
      ['an impossible date', 'from=2026-02-30&to=2026-03-01', 'from'],
      ['an unknown basis', 'basis=shipped_date', 'basis'],
      ['an unknown granularity', 'granularity=hour', 'granularity'],
      ['an unknown parameter', 'page=1', 'page'],
    ])('%s → 400', async (_label, query, field) => {
      const res = await alice.get(`/accounts/${a1}/dashboard?${query}`);
      expectError(res, 400, 'VALIDATION_ERROR');
      expect(
        (res.body as ErrorBody).error.details?.map((d) => d.field),
      ).toContain(field);
    });

    it('731 days (both ends included) is accepted, with month buckets by default', async () => {
      const d = await accountDashboard(a1, 'from=2024-10-31&to=2026-10-31');
      expect([d.filters.granularity, d.trend.length]).toEqual(['month', 25]);
    });
  });

  describe('CSV exports', () => {
    it('orders.csv: header + rows of the list filters, guarded text, untouched numbers, safe filename (member)', async () => {
      const res = await download(
        carol,
        `/accounts/${a1}/reports/orders.csv?${OCT}&sort=subOrderNo`,
      );
      expect({
        status: res.status,
        type: res.headers['content-type'],
        disposition: res.headers['content-disposition'],
        cache: res.headers['cache-control'],
      }).toEqual({
        status: 200,
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="Shop-One-orders-2026-10-01_2026-10-31.csv"; filename*=UTF-8''Shop-One-orders-2026-10-01_2026-10-31.csv`,
        cache: 'no-store',
      });
      const rows = await csvRows(
        carol,
        `/accounts/${a1}/reports/orders.csv?${OCT}&sort=subOrderNo`,
      );
      expect(rows[0]).toEqual(ORDER_CSV_HEADER);
      const listed = await list(
        `/accounts/${a1}/orders?${OCT}&sort=subOrderNo`,
      );
      expect(rows).toHaveLength(1 + listed.total);
      const observed = '2026-10-31T18:29:59.999Z';
      const ids = (
        listed.items as unknown as { id: string; subOrderNo: string }[]
      ).map((o) => o.id);
      expect(rows.slice(1)).toEqual([
        [
          ids[0],
          'A-1',
          '',
          '2026-10-01',
          'Kurti, red "cotton"',
          'SKU-A',
          '',
          '2',
          'Gujarat',
          '500.00',
          '450.00',
          'DELIVERED',
          observed,
          'matched',
          '2',
          '385.00',
          '2026-10-08',
          products['SKU-A'],
          'known',
          '100.0000',
          '2026-09-01',
          '200.0000',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
        [
          ids[1],
          'A-2',
          '',
          '2026-10-03',
          'Saree',
          'SKU-B',
          '',
          '1',
          'Kerala',
          '300.00',
          '280.00',
          'DELIVERED',
          observed,
          'matched',
          '2',
          '255.00',
          '2026-10-10',
          products['SKU-B'],
          'known',
          '333.3333',
          '2026-10-02',
          '333.3333',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
        [
          ids[2],
          'A-3',
          '',
          '2026-10-05',
          'Kurti, red "cotton"',
          'SKU-A',
          '',
          '1',
          'Delhi',
          '500.00',
          '450.00',
          'RTO',
          observed,
          'matched',
          '2',
          '-20.00',
          '2026-10-12',
          products['SKU-A'],
          'known',
          '120.0000',
          '2026-10-05',
          '120.0000',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
        [
          ids[3],
          'A-4',
          '',
          '2026-10-10',
          "'-Minus Kurti",
          'SKU-C',
          '',
          '3',
          'Goa',
          '100.00',
          '',
          'SHIPPED',
          observed,
          'unmatched',
          '0',
          '',
          '',
          products['SKU-C'],
          'unknown',
          '',
          '',
          '',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
        [
          ids[4],
          'A-6',
          '',
          '2026-10-12',
          `'=HYPERLINK("x")`,
          '',
          '',
          '1',
          'Punjab',
          '200.00',
          '190.00',
          'DELIVERED',
          observed,
          'unmatched',
          '0',
          '',
          '',
          '',
          'no_product',
          '',
          '',
          '',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
        [
          ids[5],
          'A-7',
          '',
          '2026-10-20',
          "'@SUM(A1)",
          'SKU-B',
          '',
          '1',
          'Bihar',
          '300.00',
          '280.00',
          'DELIVERED',
          observed,
          'matched',
          '1',
          '270.00',
          '2026-11-07',
          products['SKU-B'],
          'known',
          '333.3333',
          '2026-10-02',
          '333.3333',
          jobs.a1Orders,
          'orders-a1.csv',
        ],
      ]);
      // The raw bytes: the formula cell is quoted with doubled quotes and prefixed.
      expect(res.body.toString('utf8')).toContain(`,"'=HYPERLINK(""x"")",`);
    });

    it('orders.csv in the payment basis (paymentFrom / paymentTo) = the dashboard order set', async () => {
      const res = await download(
        alice,
        `/accounts/${a1}/reports/orders.csv?paymentFrom=2026-10-01&paymentTo=2026-10-31&sort=subOrderNo`,
      );
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="Shop-One-orders-2026-10-01_2026-10-31.csv"; filename*=UTF-8''Shop-One-orders-2026-10-01_2026-10-31.csv`,
      );
      const rows = await csvRows(
        alice,
        `/accounts/${a1}/reports/orders.csv?paymentFrom=2026-10-01&paymentTo=2026-10-31&sort=subOrderNo`,
      );
      expect(rows.slice(1).map((r) => [r[1], r[16]])).toEqual([
        ['A-1', '2026-10-08'],
        ['A-2', '2026-10-10'],
        ['A-3', '2026-10-12'],
        ['A-5', '2026-10-06'],
      ]);
    });

    it('settlements.csv honours dateBasis / match; negatives untouched; empty cells for missing', async () => {
      const rows = await csvRows(
        alice,
        `/accounts/${a1}/reports/settlements.csv?dateBasis=order_date&${OCT}&sort=paymentDate`,
      );
      expect(rows[0]).toEqual(SETTLEMENT_CSV_HEADER);
      expect(rows).toHaveLength(12);
      const byId = new Map(rows.slice(1).map((r) => [r[0], r]));
      expect(byId.get(s.s4)?.slice(0, 18)).toEqual([
        s.s4,
        'order_payment',
        'Order Payments',
        'T4',
        'A-3',
        '2026-10-05',
        '2026-10-20',
        '-420.00',
        '',
        '-450.00',
        '',
        '-20.00',
        '',
        '',
        '-5.00',
        '',
        'false',
        '',
      ]);
      expect(byId.get(s.s4)?.slice(18, 23)).toEqual([
        'matched',
        'auto',
        expect.any(String),
        'A-3',
        '2026-10-05',
      ]);
      expect(byId.get(s.s12)?.slice(0, 8)).toEqual([
        s.s12,
        'ads_cost',
        'Ads Cost',
        'CMP-1',
        '',
        '',
        '2026-10-14',
        '-150.00',
      ]);
      expect(byId.get(s.s12)?.[18]).toBe('account_level');
      expect(byId.has(s.s9)).toBe(false); // no order date: undated in this basis
      expect(byId.has(s.s11)).toBe(false); // superseded
      const unmatched = await csvRows(
        alice,
        `/accounts/${a1}/reports/settlements.csv?dateBasis=order_date&${OCT}&match=unmatched`,
      );
      expect(unmatched.slice(1)).toEqual([
        [
          s.s8,
          'order_payment',
          'Order Payments',
          'T8',
          'X-9',
          '2026-10-15',
          '2026-10-18',
          '99.00',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'false',
          '',
          'unmatched',
          '',
          '',
          '',
          '',
          '',
          '',
          'false',
          jobs.a1Payments,
          'payments-a1.xlsx',
          expect.any(String),
        ],
      ]);
    });

    it('expenses.csv (account; workspace scope=workspace|all; category filter); injection-guarded descriptions', async () => {
      const acc = await csvRows(
        alice,
        `/accounts/${a1}/reports/expenses.csv?${OCT}`,
      );
      expect(acc[0]).toEqual(EXPENSE_CSV_HEADER);
      expect(
        acc.slice(1).map((r) => [r[1], r[2], r[4], r[5], r[7], r[8], r[9]]),
      ).toEqual([
        [
          '2026-10-25',
          'account',
          'Shop One',
          'staff',
          "'=1+1 bonus",
          '1000.00',
          email('alice'),
        ],
        [
          '2026-10-05',
          'account',
          'Shop One',
          'packaging',
          '',
          '100.00',
          email('alice'),
        ],
      ]);
      const all = await csvRows(
        alice,
        `/workspaces/${wsA}/reports/expenses.csv?${OCT}&scope=all&sort=expenseDate`,
      );
      expect(
        all
          .slice(1)
          .map((r) => [
            r[1],
            r[2],
            r[3] === '' ? null : r[3],
            r[4],
            r[7],
            r[8],
          ]),
      ).toEqual([
        ['2026-10-05', 'account', a1, 'Shop One', '', '100.00'],
        ['2026-10-10', 'workspace', null, '', "'+91 phone bill", '300.00'],
        ['2026-10-15', 'account', a2, 'Shop Two', '', '200.00'],
        ['2026-10-25', 'account', a1, 'Shop One', "'=1+1 bonus", '1000.00'],
      ]);
      const wsOnly = await download(
        alice,
        `/workspaces/${wsA}/reports/expenses.csv?${OCT}`,
      );
      expect(wsOnly.headers['content-disposition']).toBe(
        `attachment; filename="Domain-A-expenses-2026-10-01_2026-10-31.csv"; filename*=UTF-8''Domain-A-expenses-2026-10-01_2026-10-31.csv`,
      );
      expect(
        (await csvRows(alice, `/workspaces/${wsA}/reports/expenses.csv?${OCT}`))
          .slice(1)
          .map((r) => r[8]),
      ).toEqual(['300.00']);
      const packaging = await csvRows(
        alice,
        `/accounts/${a1}/reports/expenses.csv?category=packaging`,
      );
      expect(packaging.slice(1).map((r) => r[1])).toEqual([
        '2026-10-05',
        '2026-09-30',
      ]);
      const noDates = await download(
        alice,
        `/accounts/${a1}/reports/expenses.csv?category=packaging`,
      );
      expect(noDates.headers['content-disposition']).toBe(
        `attachment; filename="Shop-One-expenses.csv"; filename*=UTF-8''Shop-One-expenses.csv`,
      );
    });

    it('more rows than REPORT_MAX_ROWS → 422 before any row, no audit row; HEAD checks without exporting', async () => {
      const before = (await auditRows()).length;
      const tooMany = await alice.get(
        `/accounts/${a1}/reports/settlements.csv`,
      );
      expectError(tooMany, 422, 'EXPORT_TOO_LARGE');
      expect((tooMany.body as ErrorBody).error.message).toBe(
        'This export has 14 rows; at most 12 rows can be exported at once. Narrow the filters (for example a shorter date range) and try again.',
      );
      expect(tooMany.headers['content-type']).toMatch(/^application\/json/);
      expect(
        (
          await download(
            alice,
            `/accounts/${a1}/reports/settlements.csv`,
            'head',
          )
        ).status,
      ).toBe(422);
      const head = await download(
        alice,
        `/accounts/${a1}/reports/settlements.csv?${OCT}`,
        'head',
      );
      expect([
        head.status,
        head.headers['content-type'],
        head.body.length,
      ]).toEqual([200, 'text/csv; charset=utf-8', 0]);
      expect((await auditRows()).length).toBe(before);
    });

    it('every export writes a report.exported audit row (type, filters, row count, actor)', async () => {
      const before = (await auditRows()).length;
      await csvRows(
        carol,
        `/accounts/${a1}/reports/orders.csv?${OCT}&status=DELIVERED`,
      );
      await csvRows(
        carol,
        `/workspaces/${wsA}/reports/expenses.csv?scope=all&${OCT}`,
      );
      const rows = (await auditRows()).slice(before);
      expect(rows).toEqual([
        {
          action: 'report.exported',
          entityType: 'seller_account',
          entityId: a1,
          actorUserId: Number(carolId),
          workspaceId: Number(wsA),
          sellerAccountId: Number(a1),
          afterData: {
            type: 'orders',
            filters: {
              from: '2026-10-01',
              to: '2026-10-31',
              status: ['DELIVERED'],
              sort: '-orderDate',
            },
            rowCount: 4,
          },
        },
        {
          action: 'report.exported',
          entityType: 'workspace',
          entityId: wsA,
          actorUserId: Number(carolId),
          workspaceId: Number(wsA),
          sellerAccountId: null,
          afterData: {
            type: 'expenses',
            filters: {
              from: '2026-10-01',
              to: '2026-10-31',
              scope: 'all',
              sort: '-expenseDate',
            },
            rowCount: 4,
          },
        },
      ]);
    });

    it('cross-tenant → 404, no session → 401, page / bad sort → 400 (JSON errors)', async () => {
      for (const path of [
        `/accounts/${a1}/reports/orders.csv`,
        `/accounts/${a1}/reports/settlements.csv?${OCT}`,
        `/accounts/${a1}/reports/expenses.csv`,
        `/workspaces/${wsA}/reports/expenses.csv`,
      ]) {
        expectError(await bob.get(path), 404, 'NOT_FOUND');
        expectError(
          await new TestClient(ctx.server).get(path),
          401,
          'UNAUTHORIZED',
        );
      }
      expectError(
        await alice.get(`/accounts/${a1}/reports/orders.csv?page=1`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(`/accounts/${a1}/reports/orders.csv?sort=amount`),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await alice.get(
          `/accounts/${a1}/reports/settlements.csv?dateBasis=ship_date`,
        ),
        400,
        'VALIDATION_ERROR',
      );
    });
  });

  it('Swagger documents the new routes', async () => {
    const res = await request(ctx.server).get('/api/docs-json').expect(200);
    expect(
      Object.keys((res.body as { paths: Record<string, unknown> }).paths),
    ).toEqual(
      expect.arrayContaining([
        '/api/v1/accounts/{accountId}/dashboard',
        '/api/v1/workspaces/{workspaceId}/dashboard',
        '/api/v1/accounts/{accountId}/reports/orders.csv',
        '/api/v1/accounts/{accountId}/reports/settlements.csv',
        '/api/v1/accounts/{accountId}/reports/expenses.csv',
        '/api/v1/workspaces/{workspaceId}/reports/expenses.csv',
      ]),
    );
  });
});
