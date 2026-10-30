import type { Sequelize } from 'sequelize-typescript';
import {
  CURRENCIES,
  EXPENSE_SCOPES,
  IMPORT_JOB_STATUSES,
  IMPORT_REPORT_TYPES,
  IMPORT_ROW_ACTIONS,
  IMPORT_ROW_STATUSES,
  PRODUCT_STATUSES,
  RECONCILIATION_RUN_STATUSES,
  RECONCILIATION_TRIGGER_TYPES,
  SELLER_ACCOUNT_STATUSES,
  SETTLEMENT_ENTRY_TYPES,
  SETTLEMENT_MATCH_METHODS,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from '../../src/database/models';
import {
  createTestSequelize,
  DOMAIN_TABLES,
  listTables,
  select,
} from './db-helpers';

/** Schema contract (Milestones 2–4), asserted from information_schema of the migrated meesho_test. */

interface ColumnRow {
  tbl: string;
  col: string;
  columnType: string;
  nullable: 'YES' | 'NO';
  def: string | null;
  coll: string | null;
  charset: string | null;
  extra: string;
}

interface FkRow {
  name: string;
  tbl: string;
  ref: string;
  del: string;
  upd: string;
  cols: string;
  refCols: string;
}

const APPEND_ONLY = ['import_rows', 'order_status_events', 'audit_logs'];

/** Tables with created_at but no updated_at: the append-only ones, plus user_sessions (last_used_at / revoked_at). */
const NO_UPDATED_AT = [...APPEND_ONLY, 'user_sessions'];

const ACCOUNT_SCOPED = [
  'import_jobs',
  'products',
  'orders',
  'order_status_events',
  'settlement_entries',
  'reconciliation_runs',
];

const MONEY_COLUMNS: Record<string, 'NULL' | 'NOT NULL'> = {
  'product_cost_history.unit_cost': 'NOT NULL',
  'orders.supplier_listed_price': 'NULL',
  'orders.supplier_discounted_price': 'NULL',
  'settlement_entries.settlement_amount': 'NOT NULL',
  'settlement_entries.sale_amount': 'NULL',
  'settlement_entries.return_amount': 'NULL',
  'settlement_entries.commission_amount': 'NULL',
  'settlement_entries.shipping_charge': 'NULL',
  'settlement_entries.tcs_amount': 'NULL',
  'settlement_entries.tds_amount': 'NULL',
  'settlement_entries.recovery_amount': 'NULL',
  'settlement_entries.compensation_amount': 'NULL',
  'expenses.amount': 'NOT NULL',
};

/** The one money column with more precision: lot-based unit costs (line cost rounds to 2 dp in M6). */
const MONEY_TYPE_EXCEPTIONS: Record<string, string> = {
  'product_cost_history.unit_cost': 'decimal(12,4)',
};

const BINARY_IDENTIFIER_COLUMNS = [
  'orders.catalog_id',
  'orders.order_no',
  'orders.packet_id',
  'orders.sku',
  'orders.sub_order_no',
  'products.catalog_id',
  'products.sku',
  'seller_accounts.meesho_supplier_id',
  'settlement_entries.sub_order_no',
  'settlement_entries.transaction_id',
];

const HASH_COLUMNS = [
  'import_jobs.active_file_sha256',
  'import_jobs.file_sha256',
  'import_rows.row_hash',
  'settlement_entries.entry_fingerprint',
  'user_sessions.token_hash',
];

const UNIQUE_KEYS = [
  'import_jobs.uq_import_jobs_account_id(seller_account_id,id)',
  'import_jobs.uq_import_jobs_account_report_active_sha256(seller_account_id,report_type,active_file_sha256)',
  'import_rows.uq_import_rows_job_id(import_job_id,id)',
  'import_rows.uq_import_rows_job_sheet_row(import_job_id,sheet_name,source_row_number)',
  'order_status_events.uq_order_status_events_order_import_job(order_id,import_job_id)',
  'orders.uq_orders_account_id(seller_account_id,id)',
  'orders.uq_orders_account_sub_order_no(seller_account_id,sub_order_no)',
  'product_cost_history.uq_product_cost_history_product_effective_from(product_id,effective_from)',
  'products.uq_products_account_id(seller_account_id,id)',
  'products.uq_products_account_sku(seller_account_id,sku)',
  'seller_accounts.uq_seller_accounts_workspace_display_name(workspace_id,display_name)',
  'seller_accounts.uq_seller_accounts_workspace_id(workspace_id,id)',
  'seller_accounts.uq_seller_accounts_workspace_supplier(workspace_id,meesho_supplier_id)',
  'settlement_entries.uq_settlement_entries_account_fingerprint(seller_account_id,entry_fingerprint)',
  'settlement_entries.uq_settlement_entries_account_id(seller_account_id,id)',
  'user_sessions.uq_user_sessions_token_hash(token_hash)',
  'users.uq_users_email(email)',
  'workspace_members.uq_workspace_members_workspace_user(workspace_id,user_id)',
];

const CASCADE = ' ON DELETE CASCADE';
const FOREIGN_KEYS = [
  'workspaces.fk_workspaces_created_by_user(created_by_user_id) -> users(id)',
  `workspace_members.fk_workspace_members_workspace(workspace_id) -> workspaces(id)${CASCADE}`,
  `workspace_members.fk_workspace_members_user(user_id) -> users(id)${CASCADE}`,
  'seller_accounts.fk_seller_accounts_workspace(workspace_id) -> workspaces(id)',
  'import_jobs.fk_import_jobs_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'import_jobs.fk_import_jobs_created_by_user(created_by_user_id) -> users(id)',
  'import_jobs.fk_import_jobs_confirmed_by_user(confirmed_by_user_id) -> users(id)',
  `import_rows.fk_import_rows_import_job(import_job_id) -> import_jobs(id)${CASCADE}`,
  'products.fk_products_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'product_cost_history.fk_product_cost_history_product(product_id) -> products(id)',
  'product_cost_history.fk_product_cost_history_created_by_user(created_by_user_id) -> users(id)',
  'orders.fk_orders_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'orders.fk_orders_product(seller_account_id,product_id) -> products(seller_account_id,id)',
  'orders.fk_orders_first_import_job(seller_account_id,first_import_job_id) -> import_jobs(seller_account_id,id)',
  'orders.fk_orders_last_import_job(seller_account_id,last_import_job_id) -> import_jobs(seller_account_id,id)',
  'orders.fk_orders_last_import_row(last_import_job_id,last_import_row_id) -> import_rows(import_job_id,id)',
  'order_status_events.fk_order_status_events_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'order_status_events.fk_order_status_events_order(seller_account_id,order_id) -> orders(seller_account_id,id)',
  'order_status_events.fk_order_status_events_import_job(seller_account_id,import_job_id) -> import_jobs(seller_account_id,id)',
  'order_status_events.fk_order_status_events_import_row(import_job_id,import_row_id) -> import_rows(import_job_id,id)',
  'settlement_entries.fk_settlement_entries_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'settlement_entries.fk_settlement_entries_import_job(seller_account_id,import_job_id) -> import_jobs(seller_account_id,id)',
  'settlement_entries.fk_settlement_entries_import_row(import_job_id,import_row_id) -> import_rows(import_job_id,id)',
  'settlement_entries.fk_settlement_entries_order(seller_account_id,order_id) -> orders(seller_account_id,id)',
  'settlement_entries.fk_settlement_entries_superseded_by(seller_account_id,superseded_by_entry_id) -> settlement_entries(seller_account_id,id)',
  'settlement_entries.fk_settlement_entries_matched_by_user(matched_by_user_id) -> users(id)',
  'expenses.fk_expenses_workspace(workspace_id) -> workspaces(id)',
  'expenses.fk_expenses_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'expenses.fk_expenses_created_by_user(created_by_user_id) -> users(id)',
  'reconciliation_runs.fk_reconciliation_runs_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'reconciliation_runs.fk_reconciliation_runs_import_job(seller_account_id,import_job_id) -> import_jobs(seller_account_id,id)',
  'reconciliation_runs.fk_reconciliation_runs_triggered_by_user(triggered_by_user_id) -> users(id)',
  'audit_logs.fk_audit_logs_workspace(workspace_id) -> workspaces(id)',
  'audit_logs.fk_audit_logs_account(workspace_id,seller_account_id) -> seller_accounts(workspace_id,id)',
  'audit_logs.fk_audit_logs_actor_user(actor_user_id) -> users(id)',
  `user_sessions.fk_user_sessions_user(user_id) -> users(id)${CASCADE}`,
];

/** Enumerated CHECKs and the model constants that must list the same values. */
const ENUM_CHECKS: Record<string, readonly string[]> = {
  ck_users_status: USER_STATUSES,
  ck_workspace_members_role: WORKSPACE_ROLES,
  ck_seller_accounts_status: SELLER_ACCOUNT_STATUSES,
  ck_import_jobs_report_type: IMPORT_REPORT_TYPES,
  ck_import_jobs_status: IMPORT_JOB_STATUSES,
  ck_import_rows_status: IMPORT_ROW_STATUSES,
  ck_import_rows_action: IMPORT_ROW_ACTIONS,
  ck_products_status: PRODUCT_STATUSES,
  ck_product_cost_history_currency: CURRENCIES,
  ck_settlement_entries_entry_type: SETTLEMENT_ENTRY_TYPES,
  ck_settlement_entries_match_method: SETTLEMENT_MATCH_METHODS,
  ck_expenses_scope: EXPENSE_SCOPES,
  ck_expenses_currency: CURRENCIES,
  ck_reconciliation_runs_trigger_type: RECONCILIATION_TRIGGER_TYPES,
  ck_reconciliation_runs_status: RECONCILIATION_RUN_STATUSES,
};

const OTHER_CHECKS = [
  'ck_audit_logs_account_workspace',
  'ck_expenses_amount',
  'ck_expenses_scope_account',
  'ck_import_jobs_report_period',
  'ck_orders_quantity',
  'ck_product_cost_history_unit_cost',
  'ck_reconciliation_runs_import_job',
  'ck_settlement_entries_auto_match',
  'ck_settlement_entries_manual_match',
  'ck_settlement_entries_match_consistency',
];

describe('schema contract (information_schema of meesho_test)', () => {
  let sequelize: Sequelize;
  let columns: ColumnRow[];
  let fks: FkRow[];

  const key = (c: ColumnRow) => `${c.tbl}.${c.col}`;
  const column = (tbl: string, col: string): ColumnRow => {
    const found = columns.find((c) => c.tbl === tbl && c.col === col);
    if (!found) throw new Error(`missing column ${tbl}.${col}`);
    return found;
  };

  beforeAll(async () => {
    sequelize = createTestSequelize(false);
    columns = await select<ColumnRow>(
      sequelize,
      `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS columnType,
              IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, COLLATION_NAME AS coll,
              CHARACTER_SET_NAME AS charset, EXTRA AS extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'sequelize_meta'
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    fks = await select<FkRow>(
      sequelize,
      `SELECT rc.CONSTRAINT_NAME AS name, rc.TABLE_NAME AS tbl, rc.REFERENCED_TABLE_NAME AS ref,
              rc.DELETE_RULE AS del, rc.UPDATE_RULE AS upd,
              GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS cols,
              GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS refCols
       FROM information_schema.REFERENTIAL_CONSTRAINTS rc
       JOIN information_schema.KEY_COLUMN_USAGE k
         ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND k.TABLE_NAME = rc.TABLE_NAME
       WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
       GROUP BY rc.CONSTRAINT_NAME, rc.TABLE_NAME, rc.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE`,
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('has exactly the 15 tables (+ sequelize_meta), all InnoDB utf8mb4_0900_ai_ci', async () => {
    expect(await listTables(sequelize)).toEqual(
      [...DOMAIN_TABLES, 'sequelize_meta'].sort(),
    );
    const tables = await select<{ tbl: string; engine: string; coll: string }>(
      sequelize,
      `SELECT TABLE_NAME AS tbl, ENGINE AS engine, TABLE_COLLATION AS coll
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'sequelize_meta'`,
    );
    expect(tables).toHaveLength(DOMAIN_TABLES.length);
    expect(
      tables.filter(
        (t) => t.engine !== 'InnoDB' || t.coll !== 'utf8mb4_0900_ai_ci',
      ),
    ).toEqual([]);
  });

  it('every primary key is id BIGINT UNSIGNED AUTO_INCREMENT; every FK column is BIGINT UNSIGNED', () => {
    for (const table of DOMAIN_TABLES) {
      const id = column(table, 'id');
      expect([table, id.columnType, id.nullable, id.extra]).toEqual([
        table,
        'bigint unsigned',
        'NO',
        'auto_increment',
      ]);
    }
    for (const fk of fks) {
      fk.cols.split(',').forEach((col, i) => {
        const refCol = fk.refCols.split(',')[i];
        expect(`${fk.name}: ${column(fk.tbl, col).columnType}`).toBe(
          `${fk.name}: ${column(fk.ref, refCol).columnType}`,
        );
        expect(column(fk.tbl, col).columnType).toBe('bigint unsigned');
      });
    }
  });

  it('created_at is DATETIME(3) NOT NULL everywhere; updated_at everywhere except NO_UPDATED_AT', () => {
    for (const table of DOMAIN_TABLES) {
      const created = column(table, 'created_at');
      expect([table, created.columnType, created.nullable]).toEqual([
        table,
        'datetime(3)',
        'NO',
      ]);
      const updated = columns.find(
        (c) => c.tbl === table && c.col === 'updated_at',
      );
      if (NO_UPDATED_AT.includes(table)) {
        expect([table, updated]).toEqual([table, undefined]);
      } else {
        expect([table, updated?.columnType, updated?.nullable]).toEqual([
          table,
          'datetime(3)',
          'NO',
        ]);
      }
    }
    // Every other DATETIME column carries milliseconds too.
    const datetimes = columns.filter((c) =>
      c.columnType.startsWith('datetime'),
    );
    expect(datetimes.filter((c) => c.columnType !== 'datetime(3)')).toEqual([]);
  });

  it('money: every DECIMAL column is decimal(12,2) (unit_cost: 12,4), has no default, NULL exactly where specified', () => {
    const decimals = columns.filter((c) => c.columnType.startsWith('decimal'));
    expect(decimals.map(key).sort()).toEqual(Object.keys(MONEY_COLUMNS).sort());
    for (const c of decimals) {
      expect({
        column: key(c),
        type: c.columnType,
        def: c.def,
        nullability: c.nullable === 'YES' ? 'NULL' : 'NOT NULL',
      }).toEqual({
        column: key(c),
        type: MONEY_TYPE_EXCEPTIONS[key(c)] ?? 'decimal(12,2)',
        def: null,
        nullability: MONEY_COLUMNS[key(c)],
      });
    }
  });

  it('account-scoped tables have NOT NULL workspace_id + seller_account_id and the composite tenancy FK', () => {
    const tenancyFk = (table: string) =>
      fks.find(
        (fk) =>
          fk.tbl === table &&
          fk.cols === 'workspace_id,seller_account_id' &&
          fk.ref === 'seller_accounts' &&
          fk.refCols === 'workspace_id,id',
      );
    for (const table of ACCOUNT_SCOPED) {
      expect([
        table,
        column(table, 'workspace_id').nullable,
        column(table, 'seller_account_id').nullable,
      ]).toEqual([table, 'NO', 'NO']);
      expect(tenancyFk(table)?.del).toBe('RESTRICT');
    }
    // Expenses: workspace always set; account optional but, when set, owned by that workspace.
    expect(column('expenses', 'workspace_id').nullable).toBe('NO');
    expect(column('expenses', 'seller_account_id').nullable).toBe('YES');
    expect(tenancyFk('expenses')?.del).toBe('RESTRICT');
  });

  it('foreign keys: exact list; CASCADE only on workspace_members, import_rows and user_sessions; ON UPDATE always RESTRICT', () => {
    const actual = fks
      .map(
        (fk) =>
          `${fk.tbl}.${fk.name}(${fk.cols}) -> ${fk.ref}(${fk.refCols})` +
          (fk.del === 'RESTRICT' ? '' : ` ON DELETE ${fk.del}`) +
          (fk.upd === 'RESTRICT' ? '' : ` ON UPDATE ${fk.upd}`),
      )
      .sort();
    expect(actual).toEqual([...FOREIGN_KEYS].sort());
  });

  it('unique keys: exact list (transaction_id and file_sha256 are deliberately NOT unique)', async () => {
    const rows = await select<{ tbl: string; name: string; cols: string }>(
      sequelize,
      `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
         AND TABLE_NAME <> 'sequelize_meta'
       GROUP BY TABLE_NAME, INDEX_NAME`,
    );
    expect(rows.map((r) => `${r.tbl}.${r.name}(${r.cols})`).sort()).toEqual(
      [...UNIQUE_KEYS].sort(),
    );
    const nonUnique = await select<{ name: string }>(
      sequelize,
      `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 1`,
    );
    expect(nonUnique.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'ix_import_jobs_account_sha256',
        'ix_settlement_entries_account_transaction',
      ]),
    );
  });

  it('CHECK constraints: all present and enforced; enum lists match the model constants', async () => {
    const checks = await select<{
      name: string;
      clause: string;
      enforced: string;
    }>(
      sequelize,
      `SELECT cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause, tc.ENFORCED AS enforced
       FROM information_schema.CHECK_CONSTRAINTS cc
       JOIN information_schema.TABLE_CONSTRAINTS tc
         ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        AND tc.CONSTRAINT_TYPE = 'CHECK'
       WHERE cc.CONSTRAINT_SCHEMA = DATABASE()`,
    );
    expect(checks.map((c) => c.name).sort()).toEqual(
      [...Object.keys(ENUM_CHECKS), ...OTHER_CHECKS].sort(),
    );
    expect(checks.filter((c) => c.enforced !== 'YES')).toEqual([]);
    for (const [name, values] of Object.entries(ENUM_CHECKS)) {
      const clause = checks.find((c) => c.name === name)?.clause ?? '';
      const literals = [...clause.matchAll(/_utf8mb4\\?'([^'\\]*)\\?'/g)].map(
        (m) => m[1],
      );
      expect({ name, values: literals.sort() }).toEqual({
        name,
        values: [...values].sort(),
      });
    }
  });

  it('collations: external identifiers utf8mb4_bin, hashes ascii_bin, users.email case-insensitive + accent-sensitive', () => {
    expect(
      columns
        .filter((c) => c.coll === 'utf8mb4_bin')
        .map(key)
        .sort(),
    ).toEqual(BINARY_IDENTIFIER_COLUMNS);
    expect(
      columns
        .filter((c) => c.coll === 'ascii_bin')
        .map(key)
        .sort(),
    ).toEqual(HASH_COLUMNS);
    for (const hash of HASH_COLUMNS) {
      const [tbl, col] = hash.split('.');
      expect(column(tbl, col).columnType).toBe('char(64)');
    }
    expect(column('users', 'email').coll).toBe('utf8mb4_0900_as_ci');
  });

  it('import_jobs.active_file_sha256 is STORED generated from status + file_sha256', async () => {
    const [generated] = await select<{ extra: string; expr: string }>(
      sequelize,
      `SELECT EXTRA AS extra, GENERATION_EXPRESSION AS expr FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_jobs'
         AND COLUMN_NAME = 'active_file_sha256'`,
    );
    expect(generated.extra).toBe('STORED GENERATED');
    expect(generated.expr).toMatch(/importing.*completed.*file_sha256/);
  });

  it('import_jobs (M4): data_as_of DATETIME(3) NULL, preview_summary JSON NULL, history_only_count INT UNSIGNED NULL, no defaults', () => {
    const asOf = column('import_jobs', 'data_as_of');
    const preview = column('import_jobs', 'preview_summary');
    const historyOnly = column('import_jobs', 'history_only_count');
    expect([asOf.columnType, asOf.nullable, asOf.def]).toEqual([
      'datetime(3)',
      'YES',
      null,
    ]);
    expect([
      historyOnly.columnType,
      historyOnly.nullable,
      historyOnly.def,
    ]).toEqual(['int unsigned', 'YES', null]);
    expect([preview.columnType, preview.nullable, preview.def]).toEqual([
      'json',
      'YES',
      null,
    ]);
    // JSON columns: the audit payloads, the row-level traceability ones and this preview summary.
    expect(
      columns
        .filter((c) => c.columnType === 'json')
        .map(key)
        .sort(),
    ).toEqual([
      'audit_logs.after_data',
      'audit_logs.before_data',
      'import_jobs.preview_summary',
      'import_rows.errors',
      'import_rows.source_values',
    ]);
  });

  it('settlement_entries.fingerprint_version is SMALLINT UNSIGNED NOT NULL without a default', () => {
    const c = column('settlement_entries', 'fingerprint_version');
    expect([c.columnType, c.nullable, c.def]).toEqual([
      'smallint unsigned',
      'NO',
      null,
    ]);
  });

  it('stores no credentials: no password/cookie/token/otp/secret column except the two hashes', () => {
    const suspicious = columns
      .map(key)
      .filter((name) => /password|cookie|token|otp|secret/i.test(name))
      .sort();
    // Both hold one-way hashes only: Argon2id of the password, SHA-256 of the session token.
    expect(suspicious).toEqual([
      'user_sessions.token_hash',
      'users.password_hash',
    ]);
  });

  it('user_sessions: token_hash CHAR(64), expiry columns NOT NULL, revoked_at nullable, no IP / user agent', () => {
    expect(
      columns
        .filter((c) => c.tbl === 'user_sessions')
        .map((c) => `${c.col} ${c.columnType} ${c.nullable}`),
    ).toEqual([
      'id bigint unsigned NO',
      'user_id bigint unsigned NO',
      'token_hash char(64) NO',
      'created_at datetime(3) NO',
      'last_used_at datetime(3) NO',
      'absolute_expires_at datetime(3) NO',
      'revoked_at datetime(3) YES',
    ]);
  });
});
