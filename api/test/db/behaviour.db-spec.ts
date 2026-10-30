import {
  QueryTypes,
  ValidationError,
  type CreationAttributes,
  type Transaction,
} from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  AuditLog,
  Expense,
  ImportJob,
  ImportRow,
  OrderStatusEvent,
  ProductCostHistory,
  ReconciliationRun,
  SettlementEntry,
  User,
  UserSession,
  Workspace,
  WorkspaceMember,
  type ImportJobStatus,
} from '../../src/database/models';
import {
  createImportJobWithRow,
  createOrder,
  createSettlement,
  createStatusEvent,
  createTestSequelize,
  ER,
  expectDbError,
  inRollback,
  seedTenant,
  select,
  type Tenant,
} from './db-helpers';

/**
 * Database-enforced integrity rules (constraints, not application code). Every test runs in a
 * transaction that is rolled back. FK rejections are paired with a control insert that differs only in
 * the column under test (see ER in db-helpers).
 */
describe('database integrity rules (meesho_test)', () => {
  let sequelize: Sequelize;

  beforeAll(() => {
    sequelize = createTestSequelize();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  const exec = (sql: string, replacements: unknown[], t: Transaction) =>
    sequelize.query(sql, { replacements, transaction: t });

  const fp = (c: string) => c.repeat(64);
  const matchedAt = new Date('2026-10-04T00:00:00.000Z');

  describe('orders', () => {
    it('sub_order_no is unique per account (exact, case-sensitive), not globally', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('ord-a', t);
        const b = await seedTenant('ord-b', t);
        await createOrder(a, t, { subOrderNo: 'SO-1' });

        await expectDbError(
          createOrder(a, t, { subOrderNo: 'SO-1' }),
          ER.DUP_ENTRY,
          'uq_orders_account_sub_order_no',
        );
        // Same identifier in another account is a different order.
        await expect(
          createOrder(b, t, { subOrderNo: 'SO-1' }),
        ).resolves.toBeDefined();
        // utf8mb4_bin: identifiers differing only in case are distinct.
        await expect(
          createOrder(a, t, { subOrderNo: 'so-1' }),
        ).resolves.toBeDefined();
      }));

    it('rejects an order whose workspace does not own its seller account', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('own-a', t);
        const b = await seedTenant('own-b', t);
        await expectDbError(
          createOrder(a, t, { workspaceId: b.workspace.id }),
          ER.NO_REFERENCED_ROW,
          'fk_orders_account',
        );
        // Control: identical row with the owning workspace is accepted.
        await expect(createOrder(a, t)).resolves.toBeDefined();
      }));

    it("rejects mapping an order to another account's product", () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('prod-a', t);
        const b = await seedTenant('prod-b', t);
        await expectDbError(
          createOrder(a, t, { productId: b.product.id }),
          ER.NO_REFERENCED_ROW,
          'fk_orders_product',
        );
        await expect(
          createOrder(a, t, { productId: a.product.id }),
        ).resolves.toBeDefined();
      }));

    it("rejects referencing another account's import job", () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('job-a', t);
        const b = await seedTenant('job-b', t);
        await expectDbError(
          createOrder(a, t, { firstImportJobId: b.job.id }),
          ER.NO_REFERENCED_ROW,
          'fk_orders_first_import_job',
        );
        await expect(
          createOrder(a, t, { firstImportJobId: a.job.id }),
        ).resolves.toBeDefined();
      }));

    it('last_import_row_id must be a row of last_import_job_id', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('lastrow', t);
        const other = await createImportJobWithRow(a, t);
        await expectDbError(
          createOrder(a, t, { lastImportRowId: other.row.id }),
          ER.NO_REFERENCED_ROW,
          'fk_orders_last_import_row',
        );
        await expect(
          createOrder(a, t, {
            lastImportJobId: other.job.id,
            lastImportRowId: other.row.id,
          }),
        ).resolves.toBeDefined();
      }));

    it('rejects quantity 0', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('qty', t);
        await expectDbError(
          createOrder(a, t, { quantity: 0 }),
          ER.CHECK_VIOLATED,
          'ck_orders_quantity',
        );
      }));
  });

  describe('order status events', () => {
    it('one observation per order per import job; a later import adds a new one', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('evt', t);
        const order = await createOrder(a, t);
        await createStatusEvent(a, order, t);
        await expectDbError(
          createStatusEvent(a, order, t),
          ER.DUP_ENTRY,
          'uq_order_status_events_order_import_job',
        );
        // A later (overlapping) import observes the order again: a new event, not a new order.
        const later = await createImportJobWithRow(a, t);
        await expect(
          createStatusEvent(a, order, t, {
            importJobId: later.job.id,
            importRowId: later.row.id,
            status: 'DELIVERED',
          }),
        ).resolves.toBeDefined();
        expect(
          await OrderStatusEvent.count({
            where: { orderId: order.id },
            transaction: t,
          }),
        ).toBe(2);
      }));

    it('cannot cite an order, import job or workspace of another account, or a row of another job', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('evx-a', t);
        const b = await seedTenant('evx-b', t);
        const orderA = await createOrder(a, t);
        const orderB = await createOrder(b, t);
        const otherJobOfA = await createImportJobWithRow(a, t);

        await expectDbError(
          createStatusEvent(a, orderB, t),
          ER.NO_REFERENCED_ROW,
          'fk_order_status_events_order',
        );
        await expectDbError(
          createStatusEvent(a, orderA, t, {
            importJobId: b.job.id,
            importRowId: b.row.id,
          }),
          ER.NO_REFERENCED_ROW,
          'fk_order_status_events_import_job',
        );
        await expectDbError(
          createStatusEvent(a, orderA, t, { importRowId: otherJobOfA.row.id }),
          ER.NO_REFERENCED_ROW,
          'fk_order_status_events_import_row',
        );
        await expectDbError(
          createStatusEvent(a, orderA, t, { workspaceId: b.workspace.id }),
          ER.NO_REFERENCED_ROW,
          'fk_order_status_events_account',
        );
        await expect(createStatusEvent(a, orderA, t)).resolves.toBeDefined();
      }));
  });

  describe('settlement entries', () => {
    it('the same transaction_id may repeat on separate entries; the same fingerprint may not', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('txn', t);
        await createSettlement(a, t, {
          transactionId: 'TXN-9',
          entryFingerprint: fp('1'),
        });
        await expect(
          createSettlement(a, t, {
            transactionId: 'TXN-9',
            entryFingerprint: fp('2'),
          }),
        ).resolves.toBeDefined();
        await expectDbError(
          createSettlement(a, t, {
            transactionId: 'TXN-OTHER',
            entryFingerprint: fp('1'),
          }),
          ER.DUP_ENTRY,
          'uq_settlement_entries_account_fingerprint',
        );
        const [{ n }] = await select<{ n: number }>(
          sequelize,
          'SELECT COUNT(*) AS n FROM settlement_entries WHERE seller_account_id = ? AND transaction_id = ?',
          [a.account.id, 'TXN-9'],
          t,
        );
        expect(Number(n)).toBe(2);
      }));

    it('rejects matching a settlement to an order of another account', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('match-a', t);
        const b = await seedTenant('match-b', t);
        const orderOfB = await createOrder(b, t);
        const manual = {
          matchMethod: 'manual' as const,
          matchedAt,
          matchedByUserId: a.user.id,
        };
        await expectDbError(
          createSettlement(a, t, { orderId: orderOfB.id, ...manual }),
          ER.NO_REFERENCED_ROW,
          'fk_settlement_entries_order',
        );
        const orderOfA = await createOrder(a, t);
        await expect(
          createSettlement(a, t, { orderId: orderOfA.id, ...manual }),
        ).resolves.toBeDefined();
      }));

    it('the source row must belong to the entry import job', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('setrow', t);
        const other = await createImportJobWithRow(a, t);
        await expectDbError(
          createSettlement(a, t, { importRowId: other.row.id }),
          ER.NO_REFERENCED_ROW,
          'fk_settlement_entries_import_row',
        );
        await expect(
          createSettlement(a, t, {
            importJobId: other.job.id,
            importRowId: other.row.id,
          }),
        ).resolves.toBeDefined();
      }));

    it('order_id and match_method are set together', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('consist', t);
        const order = await createOrder(a, t);
        await expectDbError(
          createSettlement(a, t, { orderId: order.id, matchMethod: null }),
          ER.CHECK_VIOLATED,
          'ck_settlement_entries_match_consistency',
        );
        await expectDbError(
          createSettlement(a, t, {
            orderId: null,
            matchMethod: 'manual',
            matchedAt,
            matchedByUserId: a.user.id,
          }),
          ER.CHECK_VIOLATED,
          'ck_settlement_entries_match_consistency',
        );
      }));

    it('a manual match records who and when; an auto match records when', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('matchaudit', t);
        const order = await createOrder(a, t);
        const match = (
          c: string,
          values: Partial<CreationAttributes<SettlementEntry>>,
        ) =>
          createSettlement(a, t, {
            orderId: order.id,
            entryFingerprint: fp(c),
            ...values,
          });
        await expectDbError(
          match('1', { matchMethod: 'manual', matchedAt }),
          ER.CHECK_VIOLATED,
          'ck_settlement_entries_manual_match',
        );
        await expectDbError(
          match('2', { matchMethod: 'manual', matchedByUserId: a.user.id }),
          ER.CHECK_VIOLATED,
          'ck_settlement_entries_manual_match',
        );
        await expectDbError(
          match('3', { matchMethod: 'auto' }),
          ER.CHECK_VIOLATED,
          'ck_settlement_entries_auto_match',
        );
        await expect(
          match('4', {
            matchMethod: 'manual',
            matchedAt,
            matchedByUserId: a.user.id,
          }),
        ).resolves.toBeDefined();
        await expect(
          match('5', { matchMethod: 'auto', matchedAt }),
        ).resolves.toBeDefined();
      }));

    it('superseded_by_entry_id must point to an entry of the same account', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('supa', t);
        const b = await seedTenant('supb', t);
        const old = await createSettlement(a, t, { entryFingerprint: fp('1') });
        const replacement = await createSettlement(a, t, {
          entryFingerprint: fp('2'),
        });
        const foreign = await createSettlement(b, t, {
          entryFingerprint: fp('3'),
        });
        await expectDbError(
          old.update({ supersededByEntryId: foreign.id }, { transaction: t }),
          ER.NO_REFERENCED_ROW,
          'fk_settlement_entries_superseded_by',
        );
        await expect(
          old.update(
            { supersededByEntryId: replacement.id },
            { transaction: t },
          ),
        ).resolves.toBeDefined();
      }));
  });

  describe('import jobs', () => {
    it('one importing/completed job per file, account and report type; other states stay retryable', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('dupfile-a', t);
        const b = await seedTenant('dupfile-b', t);
        const sha = fp('c');
        const job = (
          tenant: Tenant,
          status: ImportJobStatus,
          reportType: 'orders_csv' | 'settlement_xlsx' = 'orders_csv',
        ) =>
          ImportJob.create(
            {
              workspaceId: tenant.workspace.id,
              sellerAccountId: tenant.account.id,
              createdByUserId: tenant.user.id,
              reportType,
              status,
              originalFilename: 'orders.csv',
              fileSizeBytes: 10,
              fileSha256: sha,
            },
            { transaction: t },
          );

        const failed = await job(a, 'failed');
        const completed = await job(a, 'completed');
        await expectDbError(
          job(a, 'importing'),
          ER.DUP_ENTRY,
          'uq_import_jobs_account_report_active_sha256',
        );
        const pending = await job(a, 'pending');
        await expect(job(a, 'previewed')).resolves.toBeDefined();
        await expect(job(a, 'cancelled')).resolves.toBeDefined();
        await expectDbError(
          pending.update({ status: 'completed' }, { transaction: t }),
          ER.DUP_ENTRY,
          'uq_import_jobs_account_report_active_sha256',
        );
        // Same bytes as another report type, or in another account, are separate imports.
        await expect(
          job(a, 'completed', 'settlement_xlsx'),
        ).resolves.toBeDefined();
        await expect(job(b, 'completed')).resolves.toBeDefined();

        await failed.reload({ transaction: t });
        await completed.reload({ transaction: t });
        expect([failed.activeFileSha256, completed.activeFileSha256]).toEqual([
          null,
          sha,
        ]);
      }));

    it('report period end may not precede its start', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('period', t);
        const period = (
          c: string,
          reportPeriodStart: string | null,
          reportPeriodEnd: string | null,
        ) =>
          createImportJobWithRow(a, t, {
            fileSha256: fp(c),
            reportPeriodStart,
            reportPeriodEnd,
          });
        await expectDbError(
          period('1', '2026-10-31', '2026-10-01'),
          ER.CHECK_VIOLATED,
          'ck_import_jobs_report_period',
        );
        await expect(
          period('2', '2026-10-01', '2026-10-01'),
        ).resolves.toBeDefined();
        await expect(period('3', '2026-10-01', null)).resolves.toBeDefined();
      }));

    it('staging rows go with their job, but a job whose rows are referenced by canonical data cannot be deleted', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('job-del', t);
        // a.job has one staging row and nothing canonical yet: deleting it cascades the row.
        await exec('DELETE FROM import_jobs WHERE id = ?', [a.job.id], t);
        expect(
          await ImportRow.count({
            where: { importJobId: a.job.id },
            transaction: t,
          }),
        ).toBe(0);

        // b.job's row becomes canonical data (a settlement entry references the job and the row).
        const b = await seedTenant('job-keep', t);
        await createSettlement(b, t);
        await expectDbError(
          exec('DELETE FROM import_jobs WHERE id = ?', [b.job.id], t),
          ER.ROW_IS_REFERENCED,
          'fk_settlement_entries_import*',
        );
      }));
  });

  describe('money', () => {
    it('NULL stays NULL (not 0), 0 stays 0, DECIMAL reads back as an exact string', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('money', t);
        const entry = await createSettlement(a, t, {
          settlementAmount: '12345.67',
          saleAmount: null,
          commissionAmount: '0.00',
          tcsAmount: '9999999999.99',
        });
        const viaModel = await SettlementEntry.findByPk(entry.id, {
          transaction: t,
        });
        expect({
          settlementAmount: viaModel?.settlementAmount,
          saleAmount: viaModel?.saleAmount,
          commissionAmount: viaModel?.commissionAmount,
          tcsAmount: viaModel?.tcsAmount,
          returnAmount: viaModel?.returnAmount,
          isEstimate: viaModel?.isEstimate,
        }).toEqual({
          settlementAmount: '12345.67',
          saleAmount: null,
          commissionAmount: '0.00',
          tcsAmount: '9999999999.99',
          returnAmount: null,
          isEstimate: false,
        });
        const [raw] = await sequelize.query<Record<string, unknown>>(
          'SELECT settlement_amount, sale_amount, commission_amount FROM settlement_entries WHERE id = ?',
          { replacements: [entry.id], type: QueryTypes.SELECT, transaction: t },
        );
        expect(raw).toEqual({
          settlement_amount: '12345.67',
          sale_amount: null,
          commission_amount: '0.00',
        });
      }));

    it('unit_cost keeps 4 decimals exactly, may be 0 but not negative; one row per product per date', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('cost', t);
        const cost = (unitCost: string, effectiveFrom: string) =>
          ProductCostHistory.create(
            {
              productId: a.product.id,
              unitCost,
              effectiveFrom,
              createdByUserId: a.user.id,
            },
            { transaction: t },
          );
        const lot = await cost('333.3333', '2026-03-01');
        await expect(cost('0.0000', '2026-01-01')).resolves.toBeDefined();
        await expectDbError(
          cost('-0.0001', '2026-02-01'),
          ER.CHECK_VIOLATED,
          'ck_product_cost_history_unit_cost',
        );
        await expectDbError(
          cost('10.00', '2026-01-01'),
          ER.DUP_ENTRY,
          'uq_product_cost_history_product_effective_from',
        );
        const reloaded = await ProductCostHistory.findByPk(lot.id, {
          transaction: t,
        });
        const [raw] = await select<{ unit_cost: string }>(
          sequelize,
          'SELECT unit_cost FROM product_cost_history WHERE id = ?',
          [lot.id],
          t,
        );
        expect([reloaded?.unitCost, raw.unit_cost]).toEqual([
          '333.3333',
          '333.3333',
        ]);
      }));
  });

  describe('expenses', () => {
    it('scope CHECK is enforced both ways and an account must belong to the expense workspace', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('exp-a', t);
        const b = await seedTenant('exp-b', t);
        const expense = (
          scope: 'workspace' | 'account',
          sellerAccountId: number | null,
        ) =>
          Expense.create(
            {
              workspaceId: a.workspace.id,
              sellerAccountId,
              scope,
              expenseDate: '2026-10-01',
              category: 'packaging',
              amount: '250.00',
              createdByUserId: a.user.id,
            },
            { transaction: t },
          );
        await expect(expense('workspace', null)).resolves.toBeDefined();
        await expect(expense('account', a.account.id)).resolves.toBeDefined();
        await expectDbError(
          expense('workspace', a.account.id),
          ER.CHECK_VIOLATED,
          'ck_expenses_scope_account',
        );
        await expectDbError(
          expense('account', null),
          ER.CHECK_VIOLATED,
          'ck_expenses_scope_account',
        );
        await expectDbError(
          expense('account', b.account.id),
          ER.NO_REFERENCED_ROW,
          'fk_expenses_account',
        );
        await expectDbError(
          exec(
            `INSERT INTO expenses (workspace_id, scope, expense_date, category, amount, created_by_user_id, created_at, updated_at)
             VALUES (?, 'workspace', '2026-10-01', 'x', 0, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [a.workspace.id, a.user.id],
            t,
          ),
          ER.CHECK_VIOLATED,
          'ck_expenses_amount',
        );
      }));
  });

  describe('reconciliation runs', () => {
    it("an 'import' run must name its import job", () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('recon', t);
        const run = (
          triggerType: 'import' | 'manual',
          importJobId: number | null,
        ) =>
          ReconciliationRun.create(
            {
              workspaceId: a.workspace.id,
              sellerAccountId: a.account.id,
              triggerType,
              importJobId,
              status: 'running',
              startedAt: new Date(),
            },
            { transaction: t },
          );
        await expectDbError(
          run('import', null),
          ER.CHECK_VIOLATED,
          'ck_reconciliation_runs_import_job',
        );
        await expect(run('import', a.job.id)).resolves.toBeDefined();
        await expect(run('manual', null)).resolves.toBeDefined();
      }));
  });

  describe('audit logs', () => {
    it('an account must belong to the workspace, and an account requires a workspace', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('audit-a', t);
        const b = await seedTenant('audit-b', t);
        const audit = (
          workspaceId: number | null,
          sellerAccountId: number | null,
        ) =>
          AuditLog.create(
            {
              workspaceId,
              sellerAccountId,
              action: 'test.checked',
              entityType: 'test',
              entityId: '1',
            },
            { transaction: t },
          );
        await expect(
          audit(a.workspace.id, a.account.id),
        ).resolves.toBeDefined();
        await expect(audit(a.workspace.id, null)).resolves.toBeDefined();
        await expect(audit(null, null)).resolves.toBeDefined();
        await expectDbError(
          audit(b.workspace.id, a.account.id),
          ER.NO_REFERENCED_ROW,
          'fk_audit_logs_account',
        );
        await expectDbError(
          audit(null, a.account.id),
          ER.CHECK_VIOLATED,
          'ck_audit_logs_account_workspace',
        );
      }));
  });

  describe('workspaces, members and users', () => {
    it('a workspace that still has seller accounts cannot be deleted', () =>
      inRollback(sequelize, async (t) => {
        // Only RESTRICT reference to this workspace: its seller account (members cascade).
        const a = await seedTenant('ws-del', t);
        await expectDbError(
          exec('DELETE FROM workspaces WHERE id = ?', [a.workspace.id], t),
          ER.ROW_IS_REFERENCED,
          'fk_seller_accounts_workspace',
        );
      }));

    it('deleting a workspace with no accounts cascades its members', () =>
      inRollback(sequelize, async (t) => {
        const owner = await User.create(
          { email: 'cascade-owner@example.test', passwordHash: 'x' },
          { transaction: t },
        );
        const other = await User.create(
          { email: 'cascade-member@example.test', passwordHash: 'x' },
          { transaction: t },
        );
        const ws = await Workspace.create(
          { name: 'Empty workspace', createdByUserId: owner.id },
          { transaction: t },
        );
        await WorkspaceMember.bulkCreate(
          [
            { workspaceId: ws.id, userId: owner.id, role: 'owner' },
            { workspaceId: ws.id, userId: other.id, role: 'member' },
          ],
          { transaction: t },
        );
        const members = () =>
          WorkspaceMember.count({
            where: { workspaceId: ws.id },
            transaction: t,
          });
        expect(await members()).toBe(2);
        await ws.destroy({ transaction: t });
        expect(await members()).toBe(0);
        // Users survive (only the membership rows go).
        expect(
          await User.count({
            where: { id: [owner.id, other.id] },
            transaction: t,
          }),
        ).toBe(2);
      }));

    it('users.email is unique case-insensitively but accent-sensitively', () =>
      inRollback(sequelize, async (t) => {
        const user = (email: string) =>
          User.create({ email, passwordHash: 'x' }, { transaction: t });
        await user('Jose@Example.test');
        await expectDbError(
          user('jose@example.TEST'),
          ER.DUP_ENTRY,
          'uq_users_email',
        );
        await expect(user('josé@example.test')).resolves.toBeDefined();
      }));
  });

  describe('user sessions', () => {
    const session = (userId: number, tokenHash: string, t: Transaction) => {
      const now = new Date('2026-10-30T10:00:00.000Z');
      return UserSession.create(
        {
          userId,
          tokenHash,
          createdAt: now,
          lastUsedAt: now,
          absoluteExpiresAt: new Date('2026-11-06T10:00:00.000Z'),
        },
        { transaction: t },
      );
    };
    const newUser = (email: string, t: Transaction) =>
      User.create({ email, passwordHash: 'x' }, { transaction: t });

    it('token_hash is unique across all users', () =>
      inRollback(sequelize, async (t) => {
        const a = await newUser('session-a@example.test', t);
        const b = await newUser('session-b@example.test', t);
        await session(a.id, fp('a'), t);
        await expectDbError(
          session(b.id, fp('a'), t),
          ER.DUP_ENTRY,
          'uq_user_sessions_token_hash',
        );
        await expect(session(b.id, fp('b'), t)).resolves.toBeDefined();
      }));

    it('a session must belong to an existing user and is deleted with it (CASCADE)', () =>
      inRollback(sequelize, async (t) => {
        const user = await newUser('session-cascade@example.test', t);
        await expectDbError(
          session(user.id + 1_000_000, fp('c'), t),
          ER.NO_REFERENCED_ROW,
          'fk_user_sessions_user',
        );
        await session(user.id, fp('c'), t);
        await session(user.id, fp('d'), t);
        const count = () =>
          UserSession.count({ where: { userId: user.id }, transaction: t });
        expect(await count()).toBe(2);

        await user.destroy({ transaction: t });
        expect(await count()).toBe(0);
      }));

    it('stores DATETIME(3) in UTC with milliseconds; revoked_at starts NULL', () =>
      inRollback(sequelize, async (t) => {
        const user = await newUser('session-time@example.test', t);
        const created = await session(user.id, fp('e'), t);
        const [row] = await select<{
          lastUsed: string;
          revokedAt: string | null;
        }>(
          sequelize,
          `SELECT DATE_FORMAT(last_used_at, '%Y-%m-%d %H:%i:%s.%f') AS lastUsed,
                  revoked_at AS revokedAt
           FROM user_sessions WHERE id = ?`,
          [created.id],
          t,
        );
        expect(row).toEqual({
          lastUsed: '2026-10-30 10:00:00.000000',
          revokedAt: null,
        });
      }));
  });

  describe('enumerated columns reject unknown values in the database (raw SQL, bypassing model validation)', () => {
    const cases: Array<[table: string, column: string, check: string]> = [
      ['users', 'status', 'ck_users_status'],
      ['workspace_members', 'role', 'ck_workspace_members_role'],
      ['seller_accounts', 'status', 'ck_seller_accounts_status'],
      ['import_jobs', 'status', 'ck_import_jobs_status'],
      ['import_jobs', 'report_type', 'ck_import_jobs_report_type'],
      ['import_rows', 'status', 'ck_import_rows_status'],
      ['import_rows', 'action', 'ck_import_rows_action'],
      ['products', 'status', 'ck_products_status'],
      ['product_cost_history', 'currency', 'ck_product_cost_history_currency'],
      ['settlement_entries', 'entry_type', 'ck_settlement_entries_entry_type'],
      [
        'settlement_entries',
        'match_method',
        'ck_settlement_entries_match_method',
      ],
      ['expenses', 'scope', 'ck_expenses_scope'],
      ['expenses', 'currency', 'ck_expenses_currency'],
      [
        'reconciliation_runs',
        'trigger_type',
        'ck_reconciliation_runs_trigger_type',
      ],
      ['reconciliation_runs', 'status', 'ck_reconciliation_runs_status'],
    ];

    it.each(cases)('%s.%s', (table, column, check) =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant(`enum-${table}-${column}`, t);
        // Matched (with matched_at), so only the CHECK under test can fail for match_method.
        const order = await createOrder(a, t);
        await createSettlement(a, t, {
          orderId: order.id,
          matchMethod: 'auto',
          matchedAt,
        });
        await ProductCostHistory.create(
          {
            productId: a.product.id,
            unitCost: '1.0000',
            effectiveFrom: '2026-01-01',
            createdByUserId: a.user.id,
          },
          { transaction: t },
        );
        await Expense.create(
          {
            workspaceId: a.workspace.id,
            scope: 'workspace',
            expenseDate: '2026-10-01',
            category: 'misc',
            amount: '1.00',
            createdByUserId: a.user.id,
          },
          { transaction: t },
        );
        await ReconciliationRun.create(
          {
            workspaceId: a.workspace.id,
            sellerAccountId: a.account.id,
            triggerType: 'manual',
            status: 'running',
            startedAt: new Date(),
          },
          { transaction: t },
        );
        const value = column === 'currency' ? 'USD' : 'bogus_value';
        await expectDbError(
          exec(`UPDATE \`${table}\` SET \`${column}\` = ?`, [value], t),
          ER.CHECK_VIOLATED,
          check,
        );
      }),
    );

    it('the models validate the same lists before reaching the database', async () => {
      await expect(
        WorkspaceMember.build({
          workspaceId: 1,
          userId: 1,
          role: 'admin' as never,
        }).validate(),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        Expense.build({
          workspaceId: 1,
          scope: 'workspace',
          expenseDate: '2026-10-01',
          category: 'x',
          amount: '1.00',
          currency: 'USD' as never,
          createdByUserId: 1,
        }).validate(),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
