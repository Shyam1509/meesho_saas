import { QueryTypes } from 'sequelize';
import { whereClause } from '../../src/common/sql/account-scope';
import { orderListFilter } from '../../src/orders/orders.service';
import { settlementListFilter } from '../../src/settlements/settlements.service';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
} from '../support/e2e-app';
import { TestClient } from '../support/test-client';

/**
 * M7 performance check, run on demand only (not part of test:e2e; its name does not match `.e2e-spec.ts`):
 *
 *   npx cross-env NODE_ENV=test jest --config ./test/jest-e2e.json --runInBand \
 *     --testRegex 'perf/dashboard\.perf-spec\.ts$'
 *
 * Bulk-loads (plain SQL, against meesho_test) 3 seller accounts × 20,000 orders × 20,000 settlement entries
 * (~16k matched, 1.5k unmatched, 2.5k account-level; 5% of entries without a payment date), 200 SKUs with
 * costs, 500 expenses each + 100 workspace-wide, then prints median HTTP timings (7 runs after a warm-up) and
 * EXPLAIN ANALYZE of the two list filters. Everything is deleted afterwards.
 */
/**
 * PERF_KEEP=1: reuse / keep the loaded data between runs; add PERF_CLEANUP=1 to the last run to delete it.
 * PERF_PROFILE=1: instead of the timings, print every query of one dashboard call (PERF_EXPLAIN=1: and the
 * EXPLAIN ANALYZE of the three slowest).
 */
const KEEP = process.env.PERF_KEEP === '1';
const CLEANUP = !KEEP || process.env.PERF_CLEANUP === '1';
const PROFILE = process.env.PERF_PROFILE === '1';
const ORDERS = 20_000;
const ENTRIES = 20_000;
const RUNS = 7;

describe('dashboard performance (manual)', () => {
  let ctx: E2eApp;
  const runId = KEEP ? 'perfkeep' : newRunId();
  let client: TestClient;
  let ws: string;
  const accounts: string[] = [];

  const sql = (text: string, replacements: Record<string, unknown> = {}) =>
    ctx.sequelize.query(text, { replacements, type: QueryTypes.RAW });

  /** 0..99999 from five digit tables (no recursive CTE depth limit). */
  const NUMBERS = `(SELECT a.d + 10*b.d + 100*c.d + 1000*e.d + 10000*f.d AS n
      FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a
      CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b
      CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c
      CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) e
      CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) f)`;

  async function load(accountId: string, userId: string): Promise<void> {
    const r = { ws, acc: accountId, user: userId };
    const job = async (type: string) => {
      await sql(
        `INSERT INTO import_jobs (workspace_id, seller_account_id, created_by_user_id, report_type, status,
           original_filename, file_size_bytes, file_sha256, created_at, updated_at)
         VALUES (:ws, :acc, :user, :type, 'completed', 'perf', 1, SHA2(CONCAT(:acc, :type, RAND()), 256),
           UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        { ...r, type },
      );
      const [[row]] = (await ctx.sequelize.query(
        'SELECT MAX(id) AS id FROM import_jobs WHERE seller_account_id = :acc',
        { replacements: r },
      )) as unknown as [[{ id: number }]];
      await sql(
        `INSERT INTO import_rows (import_job_id, source_row_number, status, created_at)
         VALUES (:job, 1, 'imported', UTC_TIMESTAMP(3))`,
        { job: row.id },
      );
      const [[ir]] = (await ctx.sequelize.query(
        'SELECT MAX(id) AS id FROM import_rows WHERE import_job_id = :job',
        { replacements: { job: row.id } },
      )) as unknown as [[{ id: number }]];
      return { job: row.id, row: ir.id };
    };
    const orders = await job('orders_csv');
    const payments = await job('settlement_xlsx');
    await sql(
      `INSERT INTO products (workspace_id, seller_account_id, sku, name, created_at, updated_at)
       SELECT :ws, :acc, CONCAT('SKU-', n), CONCAT('Product ', n), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM ${NUMBERS} t WHERE n < 200`,
      r,
    );
    await sql(
      `INSERT INTO product_cost_history (product_id, unit_cost, effective_from, created_by_user_id, created_at, updated_at)
       SELECT p.id, 100 + MOD(p.id, 50) + 0.3333, '2026-01-01', :user, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM products p WHERE p.seller_account_id = :acc AND MOD(p.id, 10) <> 0`,
      r,
    );
    await sql(
      `INSERT INTO product_cost_history (product_id, unit_cost, effective_from, created_by_user_id, created_at, updated_at)
       SELECT p.id, 120 + MOD(p.id, 50), '2026-08-01', :user, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM products p WHERE p.seller_account_id = :acc AND MOD(p.id, 3) = 0`,
      r,
    );
    await sql(
      `INSERT INTO orders (workspace_id, seller_account_id, sub_order_no, order_date, product_id, sku, product_name,
         quantity, supplier_listed_price, supplier_discounted_price, current_status, current_status_observed_at,
         first_import_job_id, last_import_job_id, last_import_row_id, created_at, updated_at)
       SELECT :ws, :acc, CONCAT('P-', t.n), DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 184) DAY),
              IF(MOD(t.n, 50) = 0, NULL, p.id), IF(MOD(t.n, 50) = 0, NULL, p.sku), 'Perf item',
              1 + MOD(t.n, 3), 500, IF(MOD(t.n, 40) = 0, NULL, 450),
              ELT(1 + MOD(t.n, 5), 'DELIVERED', 'DELIVERED', 'SHIPPED', 'RTO', 'CANCELLED'),
              UTC_TIMESTAMP(3), :ojob, :ojob, :orow, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM ${NUMBERS} t
       JOIN products p ON p.seller_account_id = :acc AND p.sku = CONCAT('SKU-', MOD(t.n, 200))
       WHERE t.n < ${ORDERS}`,
      { ...r, ojob: orders.job, orow: orders.row },
    );
    // 16,000 matched (orders 0..13999, the first 2,000 of them twice), 1,500 unmatched, 2,500 account-level.
    await sql(
      `INSERT INTO settlement_entries (workspace_id, seller_account_id, import_job_id, import_row_id, sheet_name,
         entry_type, transaction_id, sub_order_no, order_id, order_date, payment_date, settlement_amount,
         sale_amount, commission_amount, entry_fingerprint, fingerprint_version, match_method, matched_at,
         created_at, updated_at)
       SELECT :ws, :acc, :sjob, :srow, IF(t.n < 17500, 'Order Payments', 'Ads Cost'),
              IF(t.n < 17500, 'order_payment', 'ads_cost'), CONCAT('T-', t.n),
              CASE WHEN t.n < 16000 THEN o.sub_order_no WHEN t.n < 17500 THEN CONCAT('X-', t.n) ELSE NULL END,
              IF(t.n < 16000, o.id, NULL),
              CASE WHEN t.n < 16000 THEN o.order_date WHEN t.n < 17500 THEN DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 184) DAY) END,
              IF(MOD(t.n, 20) = 7, NULL,
                 DATE_ADD(COALESCE(o.order_date, DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 184) DAY)),
                          INTERVAL 7 + MOD(t.n, 14) + IF(t.n >= 14000 AND t.n < 16000, 30, 0) DAY)),
              IF(t.n < 17500, 380.25, -150.50), IF(t.n < 16000, 450, NULL), IF(t.n < 16000, -45.10, NULL),
              SHA2(CONCAT(:acc, '-', t.n), 256), 2,
              IF(t.n < 16000, 'auto', NULL), IF(t.n < 16000, UTC_TIMESTAMP(3), NULL),
              UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM ${NUMBERS} t
       LEFT JOIN orders o ON t.n < 16000 AND o.seller_account_id = :acc
            AND o.sub_order_no = CONCAT('P-', IF(t.n < 14000, t.n, t.n - 14000))
       WHERE t.n < ${ENTRIES}`,
      { ...r, sjob: payments.job, srow: payments.row },
    );
    await sql(
      `INSERT INTO expenses (workspace_id, seller_account_id, scope, expense_date, category, amount,
         created_by_user_id, created_at, updated_at)
       SELECT :ws, :acc, 'account', DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 184) DAY), 'packaging', 99.99,
              :user, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM ${NUMBERS} t WHERE t.n < 500`,
      r,
    );
  }

  beforeAll(async () => {
    ctx = await createE2eApp();
    client = new TestClient(ctx.server);
    const login = await client.login(
      `perf-${runId}@example.test`,
      'correct horse battery',
    );
    if (login.status === 200) {
      const me = login.body as { workspaces: { id: string }[] };
      ws = me.workspaces[0].id;
      const list = await client.get(`/workspaces/${ws}/accounts`);
      const body = list.body as { id: string }[] | { items: { id: string }[] };
      for (const acc of Array.isArray(body) ? body : body.items) {
        accounts.push(acc.id);
      }
      accounts.sort((x, y) => Number(x) - Number(y));
      return;
    }
    const res = await client.register(
      `perf-${runId}@example.test`,
      'correct horse battery',
      { displayName: 'perf', workspaceName: 'Perf' },
    );
    const me = res.body as {
      user: { id: string };
      workspaces: { id: string }[];
    };
    ws = me.workspaces[0].id;
    for (const name of ['Perf A', 'Perf B', 'Perf C']) {
      const acc = await client.post(`/workspaces/${ws}/accounts`, {
        displayName: name,
      });
      accounts.push((acc.body as { id: string }).id);
    }
    for (const acc of accounts) await load(acc, me.user.id);
    await sql(
      `INSERT INTO expenses (workspace_id, seller_account_id, scope, expense_date, category, amount,
         created_by_user_id, created_at, updated_at)
       SELECT :ws, NULL, 'workspace', DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 184) DAY), 'staff', 1000,
              :user, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM ${NUMBERS} t WHERE t.n < 100`,
      { ws, user: me.user.id },
    );
    await sql('ANALYZE TABLE orders, settlement_entries, expenses');
  }, 600_000);

  afterAll(async () => {
    if (ctx) {
      if (CLEANUP) await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  }, 600_000);

  async function profile(label: string, path: string): Promise<string> {
    const seen: { ms: number; sql: string }[] = [];
    const options = ctx.sequelize.options as unknown as Record<string, unknown>;
    const before = { logging: options.logging, benchmark: options.benchmark };
    options.benchmark = true;
    options.logging = (text: string, ms?: number) =>
      seen.push({
        ms: ms ?? 0,
        sql: text.replace(/^Executed \([^)]*\): /, ''),
      });
    const start = process.hrtime.bigint();
    await client.get(path);
    const total = Number(process.hrtime.bigint() - start) / 1e6;
    Object.assign(options, before);
    const lines = seen.map(
      (q) =>
        `${String(q.ms).padStart(6)} ms  ${q.sql.replace(/\s+/g, ' ').slice(0, 140)}`,
    );
    let plans = '';
    if (process.env.PERF_EXPLAIN === '1') {
      for (const q of [...seen].sort((x, y) => y.ms - x.ms).slice(0, 3)) {
        const rows = await ctx.sequelize.query<Record<string, string>>(
          `EXPLAIN ANALYZE ${q.sql}`,
          { type: QueryTypes.SELECT },
        );
        plans += `>>> PLAN (${q.ms} ms)\n${Object.values(rows[0] ?? {})[0]}\n`;
      }
    }
    return `--- PROFILE ${label}: ${Math.round(total)} ms, ${seen.length} queries\n${lines.join('\n')}\n${plans}`;
  }

  async function median(path: string): Promise<number> {
    const first = await client.get(path);
    expect(first.status).toBe(200);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const start = process.hrtime.bigint();
      const res = await client.get(path);
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
      expect(res.status).toBe(200);
    }
    times.sort((x, y) => x - y);
    return Math.round(times[Math.floor(RUNS / 2)]);
  }

  it('prints median timings and EXPLAIN ANALYZE', async () => {
    const [a] = accounts;
    if (PROFILE) {
      const half = 'from=2026-05-01&to=2026-10-31';
      process.stdout.write(
        (await profile(
          'account order basis',
          `/accounts/${a}/dashboard?${half}`,
        )) +
          (await profile(
            'account payment basis',
            `/accounts/${a}/dashboard?${half}&basis=payment_date`,
          )) +
          (await profile(
            'workspace order basis',
            `/workspaces/${ws}/dashboard?${half}`,
          )),
      );
      return;
    }
    const half = 'from=2026-05-01&to=2026-10-31';
    const oct = 'from=2026-10-01&to=2026-10-31';
    const results: Record<string, number> = {
      'account dashboard, order basis, 184 days (weeks)': await median(
        `/accounts/${a}/dashboard?${half}`,
      ),
      'account dashboard, payment basis, 184 days (weeks)': await median(
        `/accounts/${a}/dashboard?${half}&basis=payment_date`,
      ),
      'account dashboard, order basis, October (days)': await median(
        `/accounts/${a}/dashboard?${oct}`,
      ),
      'account dashboard, payment basis, October (days)': await median(
        `/accounts/${a}/dashboard?${oct}&basis=payment_date`,
      ),
      'workspace dashboard (3 accounts), order basis, 184 days': await median(
        `/workspaces/${ws}/dashboard?${half}`,
      ),
      'workspace dashboard (3 accounts), payment basis, 184 days': await median(
        `/workspaces/${ws}/dashboard?${half}&basis=payment_date`,
      ),
      'orders list ?paymentFrom&paymentTo (October), page 1 + total':
        await median(
          `/accounts/${a}/orders?paymentFrom=2026-10-01&paymentTo=2026-10-31`,
        ),
      'settlements list ?dateBasis=order_date (October), page 1 + totals':
        await median(`/accounts/${a}/settlements?dateBasis=order_date&${oct}`),
    };
    const scope = { workspaceId: Number(ws), sellerAccountId: Number(a) };
    const explain = async (
      text: string,
      replacements: Record<string, unknown>,
    ) => {
      const rows = await ctx.sequelize.query<Record<string, string>>(
        `EXPLAIN ANALYZE ${text}`,
        { replacements, type: QueryTypes.SELECT },
      );
      return Object.values(rows[0] ?? {})[0];
    };
    const orders = orderListFilter(scope, {
      paymentFrom: '2026-10-01',
      paymentTo: '2026-10-31',
    });
    const entries = settlementListFilter(scope, {
      dateBasis: 'order_date',
      from: '2026-10-01',
      to: '2026-10-31',
      includeSuperseded: false,
    });
    const counts = {
      orders: await ctx.sequelize.query(
        `SELECT COUNT(*) AS n FROM orders o ${whereClause(orders)}`,
        { replacements: orders.replacements, type: QueryTypes.SELECT },
      ),
      entries: await ctx.sequelize.query(
        `SELECT COUNT(*) AS n FROM settlement_entries se ${whereClause(entries)}`,
        { replacements: entries.replacements, type: QueryTypes.SELECT },
      ),
    };
    process.stdout.write(
      `\n=== M7 PERF (median of ${RUNS}, ms) ===\n${JSON.stringify(results, null, 2)}\n` +
        `counts: ${JSON.stringify(counts)}\n` +
        `--- EXPLAIN ANALYZE orders COUNT, paymentFrom/paymentTo:\n${await explain(
          `SELECT COUNT(*) FROM orders o ${whereClause(orders)}`,
          orders.replacements,
        )}\n` +
        `--- EXPLAIN ANALYZE settlement_entries COUNT, dateBasis=order_date:\n${await explain(
          `SELECT COUNT(*) FROM settlement_entries se ${whereClause(entries)}`,
          entries.replacements,
        )}\n`,
    );
  }, 600_000);
});
