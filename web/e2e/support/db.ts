import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { API_ROOT, EMAIL_DOMAIN, EMAIL_PREFIX } from './env';

/**
 * Direct access to the API's TEST database (meesho_test), for the few things the UI cannot do:
 * adding a member to a workspace (there is no invitation flow yet), ending a session server-side,
 * and deleting everything the suite created.
 *
 * The connection settings are read the way the API reads them with NODE_ENV=test: `api/.env.test`
 * (parsed in this process with the API's own dotenv), real environment variables winning. Values are
 * never printed, logged or copied; errors are reduced to their code. Refuses any database whose name
 * does not end in `_test` (the API's own guard).
 */

const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

interface Mysql {
  createConnection(options: Record<string, unknown>): Promise<Connection>;
}
export interface Connection {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>;
  end(): Promise<void>;
}
interface Dotenv {
  parse(src: string | Buffer): Record<string, string>;
}

function testDbSettings(): Record<string, unknown> {
  const dotenv = apiRequire('dotenv') as Dotenv;
  let fromFile: Record<string, string> = {};
  try {
    fromFile = dotenv.parse(readFileSync(path.join(API_ROOT, '.env.test')));
  } catch {
    throw new Error('api/.env.test could not be read (see api/README.md "Setup").');
  }
  const value = (name: string): string => {
    const v = (process.env[name] ?? fromFile[name] ?? '').trim();
    if (v === '') {
      // The name only, never a value.
      throw new Error(`Missing ${name} in api/.env.test`);
    }
    return v;
  };
  const database = value('DB_NAME');
  if (!database.endsWith('_test')) {
    throw new Error('Refusing to touch a database whose DB_NAME does not end in "_test".');
  }
  return {
    host: value('DB_HOST'),
    port: Number(value('DB_PORT')),
    database,
    user: value('DB_USER'),
    password: value('DB_PASSWORD'),
    timezone: 'Z',
    multipleStatements: false,
  };
}

/** Runs `fn` with one connection to the test database, then closes it. */
export async function withTestDb<T>(fn: (db: Connection) => Promise<T>): Promise<T> {
  const mysql = apiRequire('mysql2/promise') as Mysql;
  let db: Connection;
  try {
    db = await mysql.createConnection(testDbSettings());
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (error instanceof Error && !code) {
      throw error;
    }
    // The cause is dropped on purpose: a driver error can name the database user and host.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Could not connect to the test database (${code ?? 'unknown error'}).`);
  }
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

const E2E_EMAILS = `${EMAIL_PREFIX}%${EMAIL_DOMAIN}`;

/**
 * Deletes every user whose email starts with `e2e-` (and ends in @example.test), the workspaces they
 * created and every row of those workspaces, children first: the same order as the API suites'
 * `deleteRunData` (api/test/support/e2e-app.ts). Memberships, sessions and import rows cascade.
 * Returns the number of users deleted.
 */
export async function deleteE2eData(): Promise<number> {
  return withTestDb(async (db) => {
    const run = (sql: string) => db.query(sql, [E2E_EMAILS]);
    const runWorkspaces = `SELECT w.id FROM workspaces w JOIN users u ON u.id = w.created_by_user_id
                           WHERE u.email LIKE ?`;
    await db.query(
      `DELETE FROM audit_logs
       WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE ?)
          OR workspace_id IN (${runWorkspaces})`,
      [E2E_EMAILS, E2E_EMAILS],
    );
    await run(
      `UPDATE settlement_entries SET superseded_by_entry_id = NULL
       WHERE workspace_id IN (${runWorkspaces}) AND superseded_by_entry_id IS NOT NULL`,
    );
    for (const table of [
      'reconciliation_runs',
      'settlement_entries',
      'order_status_events',
      'orders',
      'import_jobs',
    ]) {
      await run(`DELETE FROM ${table} WHERE workspace_id IN (${runWorkspaces})`);
    }
    await run(
      `DELETE FROM product_cost_history WHERE product_id IN
         (SELECT id FROM products WHERE workspace_id IN (${runWorkspaces}))`,
    );
    await run(`DELETE FROM products WHERE workspace_id IN (${runWorkspaces})`);
    await run(`DELETE FROM expenses WHERE workspace_id IN (${runWorkspaces})`);
    await run(`DELETE FROM seller_accounts WHERE workspace_id IN (${runWorkspaces})`);
    await run(
      `DELETE FROM workspaces WHERE created_by_user_id IN
         (SELECT id FROM users WHERE email LIKE ?)`,
    );
    const [result] = await run(`DELETE FROM users WHERE email LIKE ?`);
    return (result as { affectedRows?: number }).affectedRows ?? 0;
  });
}

/** Row counts after a cleanup: all rows, and the rows still owned by e2e users (should be 0). */
export async function tableCounts(): Promise<Record<string, { all: number; e2e: number }>> {
  return withTestDb(async (db) => {
    const count = async (sql: string, values: unknown[] = []) => {
      const [rows] = await db.query<{ n: number }[]>(sql, values);
      return Number(rows[0]?.n ?? 0);
    };
    const e2eWorkspaces = `SELECT w.id FROM workspaces w JOIN users u ON u.id = w.created_by_user_id
                           WHERE u.email LIKE ?`;
    return {
      users: {
        all: await count('SELECT COUNT(*) AS n FROM users'),
        e2e: await count('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?', [E2E_EMAILS]),
      },
      workspaces: {
        all: await count('SELECT COUNT(*) AS n FROM workspaces'),
        e2e: await count(`SELECT COUNT(*) AS n FROM (${e2eWorkspaces}) x`, [E2E_EMAILS]),
      },
      orders: {
        all: await count('SELECT COUNT(*) AS n FROM orders'),
        e2e: await count(
          `SELECT COUNT(*) AS n FROM orders WHERE workspace_id IN (${e2eWorkspaces})`,
          [E2E_EMAILS],
        ),
      },
    };
  });
}

/** Makes `memberEmail` a plain member of `workspaceId` (no invitation flow exists yet). */
export async function addWorkspaceMember(workspaceId: string, memberEmail: string): Promise<void> {
  await withTestDb(async (db) => {
    const [result] = await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at)
       SELECT ?, u.id, 'member', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) FROM users u WHERE u.email = ?`,
      [workspaceId, memberEmail],
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) {
      throw new Error('The member could not be added (user not found).');
    }
  });
}

/** Ends every session of a user server-side, as an idle timeout or a revoke would. */
export async function endSessionsOf(email: string): Promise<number> {
  return withTestDb(async (db) => {
    const [result] = await db.query(
      `DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)`,
      [email],
    );
    return (result as { affectedRows?: number }).affectedRows ?? 0;
  });
}
