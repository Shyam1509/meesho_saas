import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { QueryTypes } from 'sequelize';
import { ExportLimiter } from '../src/reports/export-limiter';
import {
  EXPORT_RETRY_AFTER_SECONDS,
  EXPORTS_BUSY_MESSAGE,
} from '../src/reports/reports.service';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
} from './support/e2e-app';
import { API, type ErrorBody, TestClient } from './support/test-client';

const STALL_MS = 3000;
const ROWS = 20_000;

/**
 * CSV export resource safety (M7 review H1), with real sockets: an export holds ONE pooled connection while it
 * streams, at most 2 exports stream at once (more → 429), a client that leaves releases everything at once,
 * and a client that stops reading is cut off after the stall timeout (pinned to 3 s here; 60 s in the app).
 * 20,000 expenses with long descriptions (~8 MB of CSV) are inserted in SQL so a paused client really blocks
 * the server on backpressure.
 */
describe('CSV exports: concurrency, client abort, stalled clients (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  let client: TestClient;
  let limiter: ExportLimiter;
  let port: number;
  let ws: string;
  let account: string;
  let path: string;

  const pool = () =>
    (
      ctx.sequelize.connectionManager as unknown as {
        pool: { using: number };
      }
    ).pool;

  async function until(
    condition: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<number> {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for ${label}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Date.now() - start;
  }

  /** A real HTTP GET whose body is never read (the socket stops reading once its buffers are full). */
  function openPaused(): Promise<{
    req: http.ClientRequest;
    res: http.IncomingMessage;
  }> {
    const cookie = [...client.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `${API}${path}`,
          headers: { Cookie: cookie },
        },
        (res) => {
          res.pause();
          // The server cutting a stalled response surfaces as an 'aborted' / ECONNRESET error here.
          res.on('error', () => undefined);
          resolve({ req, res });
        },
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'ECONNRESET') reject(err);
      });
    });
  }

  async function exportAudits(): Promise<number> {
    const [row] = await ctx.sequelize.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'report.exported' AND workspace_id = ?`,
      { replacements: [ws], type: QueryTypes.SELECT },
    );
    return Number(row.n);
  }

  beforeAll(async () => {
    ctx = await createE2eApp({
      reportMaxConcurrentExports: 2,
      reportStallTimeoutMs: STALL_MS,
    });
    await new Promise<void>((resolve) => ctx.server.listen(0, resolve));
    port = (ctx.server.address() as AddressInfo).port;
    limiter = ctx.app.get(ExportLimiter);
    client = new TestClient(ctx.server);
    const res = await client.register(
      `stream-${runId}@example.test`,
      'correct horse battery',
      { displayName: 'stream', workspaceName: 'Streaming' },
    );
    const me = res.body as {
      user: { id: string };
      workspaces: { id: string }[];
    };
    ws = me.workspaces[0].id;
    const acc = await client.post(`/workspaces/${ws}/accounts`, {
      displayName: 'Big Shop',
    });
    account = (acc.body as { id: string }).id;
    const digits =
      '(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
    await ctx.sequelize.query(
      `INSERT INTO expenses (workspace_id, seller_account_id, scope, expense_date, category, description, amount,
         created_by_user_id, created_at, updated_at)
       SELECT :ws, :acc, 'account', DATE_ADD('2026-05-01', INTERVAL MOD(t.n, 180) DAY), 'packaging',
              CONCAT('Row ', t.n, ' ', REPEAT('x', 240)), 99.99, :user, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM (SELECT a.d + 10*b.d + 100*c.d + 1000*e.d + 10000*f.d AS n
             FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} e
             CROSS JOIN ${digits} f) t
       WHERE t.n < ${ROWS}`,
      { replacements: { ws, acc: account, user: me.user.id } },
    );
    path = `/accounts/${account}/reports/expenses.csv`;
  }, 120_000);

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  it('two stalled exports hold both slots and ONE connection each; a third → 429 Retry-After; the API still answers; the stall timeout frees everything', async () => {
    const auditsBefore = await exportAudits();
    const first = await openPaused();
    const second = await openPaused();
    expect([first.res.statusCode, second.res.statusCode]).toEqual([200, 200]);
    await until(() => limiter.active === 2, 5000, 'two running exports');
    // Still blocked a moment later (backpressure, not finished), each on exactly one pooled connection.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect([limiter.active, pool().using]).toEqual([2, 2]);
    // Both audit rows were written (in their own short transactions) before streaming began.
    expect(await exportAudits()).toBe(auditsBefore + 2);

    const busy = await client.get(path);
    expect({
      status: busy.status,
      code: (busy.body as ErrorBody).error?.code,
      message: (busy.body as ErrorBody).error?.message,
      retryAfter: busy.headers['retry-after'],
    }).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
      message: EXPORTS_BUSY_MESSAGE,
      retryAfter: String(EXPORT_RETRY_AFTER_SECONDS),
    });
    expect(await exportAudits()).toBe(auditsBefore + 2); // the refused one wrote none
    expect((await client.get('/auth/me')).status).toBe(200);

    // Nobody reads: after the stall timeout the server cuts both responses and releases slots + connections.
    const waited = await until(
      () => limiter.active === 0 && pool().using === 0,
      STALL_MS + 5000,
      'the stall timeout',
    );
    expect(waited).toBeGreaterThanOrEqual(STALL_MS - 1000);
    // The clients never got a complete body (the server cut the responses); drop our ends too.
    expect([first.res.complete, second.res.complete]).toEqual([false, false]);
    first.req.destroy();
    second.req.destroy();

    // And a normal export (supertest reads everything) completes afterwards.
    const full = await client.get(`${path}?from=2026-05-01&to=2026-05-10`);
    expect(full.status).toBe(200);
    expect(full.text.split('\r\n').length - 2).toBe(1120); // 10 of 180 days × 20,000 rows / 180 + header
    expect([limiter.active, pool().using]).toEqual([0, 0]);
  }, 30_000);

  it('a client that aborts mid-export releases its slot and connection at once (long before the stall timeout)', async () => {
    const open = await openPaused();
    await until(() => limiter.active === 1, 5000, 'a running export');
    expect(pool().using).toBe(1);
    const aborted = Date.now();
    open.req.destroy();
    await until(
      () => limiter.active === 0 && pool().using === 0,
      STALL_MS,
      'the abort to release',
    );
    expect(Date.now() - aborted).toBeLessThan(STALL_MS);
    // The API still answers, and exports work again.
    expect((await client.get('/auth/me')).status).toBe(200);
    expect(
      (await client.get(`${path}?from=2026-05-01&to=2026-05-01`)).status,
    ).toBe(200);
  }, 30_000);

  it('HEAD runs only the count: no slot, no audit row, no body', async () => {
    const before = await exportAudits();
    const cookie = [...client.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(
        {
          method: 'HEAD',
          host: '127.0.0.1',
          port,
          path: `${API}${path}`,
          headers: { Cookie: cookie },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
    expect(await exportAudits()).toBe(before);
    expect(limiter.active).toBe(0);
  });
});
