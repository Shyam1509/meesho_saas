import {
  QueryTypes,
  type CreationAttributes,
  type Transaction,
} from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  ImportJob,
  ImportRow,
  MODELS,
  Order,
  OrderStatusEvent,
  Product,
  SellerAccount,
  SettlementEntry,
  User,
  Workspace,
  WorkspaceMember,
} from '../../src/database/models';
import { assertTestEnvironment } from './sequelize-cli';

interface CliDbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/** The 14 tables created by Milestone 2, in migration order. */
export const DOMAIN_TABLES = [
  'users',
  'workspaces',
  'workspace_members',
  'seller_accounts',
  'import_jobs',
  'import_rows',
  'products',
  'product_cost_history',
  'orders',
  'order_status_events',
  'settlement_entries',
  'expenses',
  'reconciliation_runs',
  'audit_logs',
] as const;

/**
 * MySQL error numbers asserted by the behaviour specs.
 * Foreign-key errors: MySQL names the constraint (1451/1452) only to users with table-level privileges
 * on the parent tables; the least-privilege app user (database-level grants) gets the generic 1216/1217
 * without a name. Specs therefore pair every FK rejection with a control insert that differs in that one
 * column and succeeds.
 */
export const ER = {
  DUP_ENTRY: [1062],
  CHECK_VIOLATED: [3819],
  NO_REFERENCED_ROW: [1452, 1216],
  ROW_IS_REFERENCED: [1451, 1217],
} as const;

/** Generic FK errors whose message carries no constraint name. */
const UNNAMED_ERRNOS: readonly number[] = [1216, 1217];

/**
 * Connection settings from db/config.js `test` (loads .env.test; throws unless DB_NAME ends in "_test").
 * Credentials stay in memory only.
 */
function testDbConfig(): CliDbConfig {
  assertTestEnvironment();
  return jest.requireActual<{ test: CliDbConfig }>('../../db/config.js').test;
}

/** Same connection options as DatabaseModule (UTC, underscored, DECIMAL as string); never syncs. */
export function createTestSequelize(withModels = true): Sequelize {
  const db = testDbConfig();
  return new Sequelize({
    dialect: 'mysql',
    host: db.host,
    port: db.port,
    database: db.database,
    username: db.username,
    password: db.password,
    timezone: '+00:00',
    define: { underscored: true },
    logging: false,
    pool: { max: 2, min: 0 },
    models: withModels ? [...MODELS] : [],
  });
}

export async function select<T extends object>(
  sequelize: Sequelize,
  sql: string,
  replacements: unknown[] = [],
  transaction?: Transaction,
): Promise<T[]> {
  return sequelize.query<T>(sql, {
    type: QueryTypes.SELECT,
    replacements,
    transaction,
  });
}

/** Current schema's base tables, sorted. */
export async function listTables(sequelize: Sequelize): Promise<string[]> {
  const rows = await select<{ name: string }>(
    sequelize,
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  return rows.map((r) => r.name);
}

interface MysqlErrorLike {
  errno?: number;
  sqlMessage?: string;
}

/**
 * Awaits `action`, expecting a MySQL error whose errno is one of `errnos`. When MySQL names the
 * constraint (always for unique keys and CHECKs), it must be exactly `constraint`
 * (quoted as 'ck_x' / 'table.uq_x' / `fk_x`). A name ending in '*' matches that prefix.
 */
export async function expectDbError(
  action: Promise<unknown>,
  errnos: readonly number[],
  constraint: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  const parent = (caught as { parent?: MysqlErrorLike }).parent;
  const errno = parent?.errno ?? -1;
  expect({ errno, allowed: errnos.includes(errno) }).toEqual({
    errno,
    allowed: true,
  });
  if (UNNAMED_ERRNOS.includes(errno)) return;
  const name = constraint.endsWith('*')
    ? `${constraint.slice(0, -1)}\\w*`
    : constraint;
  expect(parent?.sqlMessage).toMatch(new RegExp(`[\`'.]${name}[\`']`));
}

/** Runs `fn` in a transaction that is always rolled back, so specs leave no rows behind. */
export async function inRollback(
  sequelize: Sequelize,
  fn: (t: Transaction) => Promise<void>,
): Promise<void> {
  const t = await sequelize.transaction();
  try {
    await fn(t);
  } finally {
    await t.rollback();
  }
}

export interface Tenant {
  user: User;
  workspace: Workspace;
  member: WorkspaceMember;
  account: SellerAccount;
  job: ImportJob;
  row: ImportRow;
  product: Product;
}

/** user -> workspace (+ owner membership) -> seller account -> import job + row -> product. */
export async function seedTenant(
  label: string,
  t: Transaction,
): Promise<Tenant> {
  const transaction = t;
  const user = await User.create(
    { email: `${label}@example.test`, passwordHash: 'not-a-real-hash' },
    { transaction },
  );
  const workspace = await Workspace.create(
    { name: `Workspace ${label}`, createdByUserId: user.id },
    { transaction },
  );
  const member = await WorkspaceMember.create(
    { workspaceId: workspace.id, userId: user.id, role: 'owner' },
    { transaction },
  );
  const account = await SellerAccount.create(
    { workspaceId: workspace.id, displayName: `Account ${label}` },
    { transaction },
  );
  const job = await ImportJob.create(
    {
      workspaceId: workspace.id,
      sellerAccountId: account.id,
      createdByUserId: user.id,
      reportType: 'settlement_xlsx',
      status: 'completed',
      originalFilename: `${label}.xlsx`,
      fileSizeBytes: 1024,
      fileSha256: 'a'.repeat(64),
    },
    { transaction },
  );
  const row = await ImportRow.create(
    {
      importJobId: job.id,
      sheetName: 'Order Payments',
      sourceRowNumber: 2,
      status: 'imported',
    },
    { transaction },
  );
  const product = await Product.create(
    { workspaceId: workspace.id, sellerAccountId: account.id, sku: 'SKU-1' },
    { transaction },
  );
  return { user, workspace, member, account, job, row, product };
}

export async function createOrder(
  tenant: Tenant,
  t: Transaction,
  overrides: Partial<CreationAttributes<Order>> = {},
): Promise<Order> {
  return Order.create(
    {
      workspaceId: tenant.workspace.id,
      sellerAccountId: tenant.account.id,
      subOrderNo: 'SO-1001',
      orderDate: '2026-10-01',
      quantity: 1,
      currentStatus: 'DELIVERED',
      currentStatusObservedAt: new Date('2026-10-02T10:00:00.000Z'),
      firstImportJobId: tenant.job.id,
      lastImportJobId: tenant.job.id,
      lastImportRowId: tenant.row.id,
      ...overrides,
    },
    { transaction: t },
  );
}

export async function createSettlement(
  tenant: Tenant,
  t: Transaction,
  overrides: Partial<CreationAttributes<SettlementEntry>> = {},
): Promise<SettlementEntry> {
  return SettlementEntry.create(
    {
      workspaceId: tenant.workspace.id,
      sellerAccountId: tenant.account.id,
      importJobId: tenant.job.id,
      importRowId: tenant.row.id,
      sheetName: 'Order Payments',
      entryType: 'order_payment',
      transactionId: 'TXN-1',
      settlementAmount: '100.00',
      entryFingerprint: 'f'.repeat(64),
      fingerprintVersion: 1,
      ...overrides,
    },
    { transaction: t },
  );
}

/** Another import job of the tenant's account (a distinct file), with one source row. */
export async function createImportJobWithRow(
  tenant: Tenant,
  t: Transaction,
  overrides: Partial<CreationAttributes<ImportJob>> = {},
): Promise<{ job: ImportJob; row: ImportRow }> {
  const job = await ImportJob.create(
    {
      workspaceId: tenant.workspace.id,
      sellerAccountId: tenant.account.id,
      createdByUserId: tenant.user.id,
      reportType: 'orders_csv',
      status: 'completed',
      originalFilename: 'orders.csv',
      fileSizeBytes: 10,
      fileSha256: 'b'.repeat(64),
      ...overrides,
    },
    { transaction: t },
  );
  const row = await ImportRow.create(
    { importJobId: job.id, sourceRowNumber: 2, status: 'imported' },
    { transaction: t },
  );
  return { job, row };
}

export async function createStatusEvent(
  tenant: Tenant,
  order: Order,
  t: Transaction,
  overrides: Partial<CreationAttributes<OrderStatusEvent>> = {},
): Promise<OrderStatusEvent> {
  return OrderStatusEvent.create(
    {
      workspaceId: tenant.workspace.id,
      sellerAccountId: tenant.account.id,
      orderId: order.id,
      importJobId: tenant.job.id,
      importRowId: tenant.row.id,
      status: 'SHIPPED',
      observedAt: new Date('2026-10-03T08:15:30.123Z'),
      ...overrides,
    },
    { transaction: t },
  );
}
