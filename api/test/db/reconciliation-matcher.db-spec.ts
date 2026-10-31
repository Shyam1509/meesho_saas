import type { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SettlementEntry } from '../../src/database/models';
import { ReconciliationMatcherService } from '../../src/reconciliation/reconciliation-matcher.service';
import {
  createImportJobWithRow,
  createOrder,
  createSettlement,
  createTestSequelize,
  inRollback,
  seedTenant,
  type Tenant,
} from './db-helpers';

/**
 * The automatic matching rule against the migrated meesho_test (every case in a rolled-back
 * transaction): exact same-account sub order match, account-level entries untouched, blocked / superseded
 * entries skipped, existing (manual or auto) matches never re-pointed, and the run row's counts.
 */
describe('ReconciliationMatcherService (meesho_test)', () => {
  let sequelize: Sequelize;
  let matcher: ReconciliationMatcherService;
  let fingerprint = 0;

  beforeAll(() => {
    sequelize = createTestSequelize();
    matcher = new ReconciliationMatcherService(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  /** An entry with a unique fingerprint (the account-level key). */
  function entry(
    tenant: Tenant,
    t: Transaction,
    overrides: Parameters<typeof createSettlement>[2] = {},
  ) {
    fingerprint += 1;
    return createSettlement(tenant, t, {
      entryFingerprint: fingerprint.toString(16).padStart(64, '0'),
      fingerprintVersion: 2,
      ...overrides,
    });
  }

  const run = (tenant: Tenant, t: Transaction) =>
    matcher.matchAndRecord(
      { workspaceId: tenant.workspace.id, sellerAccountId: tenant.account.id },
      // Every entry these cases create belongs to tenant.job, so a run for that settlement job sees them all.
      {
        type: 'import',
        importJobId: tenant.job.id,
        reportType: 'settlement_xlsx',
        userId: tenant.user.id,
      },
      t,
    );

  const manualRun = (tenant: Tenant, t: Transaction) =>
    matcher.matchAndRecord(
      { workspaceId: tenant.workspace.id, sellerAccountId: tenant.account.id },
      { type: 'manual', userId: tenant.user.id },
      t,
    );

  const reload = (e: SettlementEntry, t: Transaction) =>
    SettlementEntry.findByPk(e.id, { transaction: t, rejectOnEmpty: true });

  it('matches by exact sub order no within the account; repeated rows all match; account-level and orderless rows stay', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-basic', t);
      const so1 = await createOrder(a, t, { subOrderNo: 'SO-1' });
      await createOrder(a, t, { subOrderNo: 'SO-2' });
      const first = await entry(a, t, { subOrderNo: 'SO-1' });
      const repeat = await entry(a, t, { subOrderNo: 'SO-1' });
      const orphan = await entry(a, t, { subOrderNo: 'SO-404' });
      const lowerCase = await entry(a, t, { subOrderNo: 'so-1' });
      const ads = await entry(a, t, {
        subOrderNo: null,
        entryType: 'ads_cost',
        sheetName: 'Ads Cost',
      });

      const before = Date.now();
      const runRow = await run(a, t);

      for (const e of [first, repeat]) {
        const after = await reload(e, t);
        expect([
          after.orderId,
          after.matchMethod,
          after.matchedByUserId,
        ]).toEqual([so1.id, 'auto', null]);
        expect(after.matchedAt?.getTime()).toBeGreaterThanOrEqual(
          before - 1000,
        );
        expect(after.matchedAt?.getTime()).toBeLessThanOrEqual(
          Date.now() + 1000,
        );
      }
      for (const e of [orphan, lowerCase, ads]) {
        expect((await reload(e, t)).orderId).toBeNull();
      }
      expect({
        trigger: runRow.triggerType,
        importJobId: runRow.importJobId,
        user: runRow.triggeredByUserId,
        status: runRow.status,
        matched: runRow.matchedCount,
        unmatchedSettlements: runRow.unmatchedSettlementCount,
        unmatchedOrders: runRow.unmatchedOrderCount,
      }).toEqual({
        trigger: 'import',
        importJobId: a.job.id,
        user: a.user.id,
        status: 'completed',
        matched: 2,
        // SO-404 and 'so-1' (exact, case-sensitive); the ads entry is account-level, never an exception.
        unmatchedSettlements: 2,
        // SO-2 has no entry.
        unmatchedOrders: 1,
      });

      // A second run finds nothing new.
      const again = await run(a, t);
      expect([again.matchedCount, again.unmatchedSettlementCount]).toEqual([
        0, 2,
      ]);
    }));

  it('skips entries blocked by a manual unmatch', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-blocked', t);
      await createOrder(a, t, { subOrderNo: 'SO-1' });
      const blocked = await entry(a, t, {
        subOrderNo: 'SO-1',
        autoMatchBlocked: true,
      });
      const runRow = await run(a, t);
      const after = await reload(blocked, t);
      expect([
        after.orderId,
        after.matchMethod,
        after.autoMatchBlocked,
      ]).toEqual([null, null, true]);
      expect([
        runRow.matchedCount,
        runRow.unmatchedSettlementCount,
        runRow.unmatchedOrderCount,
      ]).toEqual([0, 1, 1]);
    }));

  it('never touches an existing manual or auto match, even when its sub order points at another order', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-keep', t);
      await createOrder(a, t, { subOrderNo: 'SO-1' });
      const so2 = await createOrder(a, t, { subOrderNo: 'SO-2' });
      const matchedAt = new Date('2026-10-01T00:00:00.000Z');
      const manual = await entry(a, t, {
        subOrderNo: 'SO-1',
        orderId: so2.id,
        matchMethod: 'manual',
        matchedAt,
        matchedByUserId: a.user.id,
      });
      const auto = await entry(a, t, {
        subOrderNo: 'SO-1',
        orderId: so2.id,
        matchMethod: 'auto',
        matchedAt,
      });
      const runRow = await run(a, t);
      for (const e of [manual, auto]) {
        const after = await reload(e, t);
        expect([after.orderId, after.matchMethod, after.matchedAt]).toEqual([
          so2.id,
          e.matchMethod,
          matchedAt,
        ]);
      }
      expect(runRow.matchedCount).toBe(0);
      // SO-1 has no matched entry (both point at SO-2).
      expect(runRow.unmatchedOrderCount).toBe(1);
    }));

  it('skips superseded entries; an order whose only entry is superseded has no settlement', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-superseded', t);
      await createOrder(a, t, { subOrderNo: 'SO-1' });
      await createOrder(a, t, { subOrderNo: 'SO-2' });
      const final = await entry(a, t, { subOrderNo: 'SO-1' });
      const estimate = await entry(a, t, {
        subOrderNo: 'SO-1',
        supersededByEntryId: final.id,
      });
      const oldSo2 = await entry(a, t, { subOrderNo: 'SO-2' });
      const newSo2 = await entry(a, t, { subOrderNo: 'SO-404' });
      await oldSo2.update(
        { supersededByEntryId: newSo2.id },
        { transaction: t },
      );

      const runRow = await run(a, t);
      expect((await reload(final, t)).matchMethod).toBe('auto');
      expect((await reload(estimate, t)).orderId).toBeNull();
      expect((await reload(oldSo2, t)).orderId).toBeNull();
      expect({
        matched: runRow.matchedCount,
        // SO-404 only: superseded rows are never exceptions.
        unmatchedSettlements: runRow.unmatchedSettlementCount,
        // SO-2: its only entry is superseded.
        unmatchedOrders: runRow.unmatchedOrderCount,
      }).toEqual({ matched: 1, unmatchedSettlements: 1, unmatchedOrders: 1 });
    }));

  it("never matches another account's order, and a run of one account leaves the other's entries alone", () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-tenant-a', t);
      const b = await seedTenant('match-tenant-b', t);
      const orderOfB = await createOrder(b, t, { subOrderNo: 'SO-1' });
      const entryOfA = await entry(a, t, { subOrderNo: 'SO-1' });
      const entryOfB = await entry(b, t, { subOrderNo: 'SO-1' });

      const runA = await run(a, t);
      expect((await reload(entryOfA, t)).orderId).toBeNull();
      expect((await reload(entryOfB, t)).orderId).toBeNull();
      expect([
        runA.matchedCount,
        runA.unmatchedSettlementCount,
        runA.unmatchedOrderCount,
      ]).toEqual([0, 1, 0]);

      const runB = await run(b, t);
      expect((await reload(entryOfB, t)).orderId).toBe(orderOfB.id);
      expect((await reload(entryOfA, t)).orderId).toBeNull();
      expect(runB.matchedCount).toBe(1);
    }));

  it('a settlement import run matches only its OWN entries; a manual run picks up older unmatched ones', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-scope-settlement', t);
      await createOrder(a, t, { subOrderNo: 'SO-OLD' });
      await createOrder(a, t, { subOrderNo: 'SO-NEW' });
      // Left unmatched by an earlier job (e.g. imported before matching existed).
      const older = await entry(a, t, { subOrderNo: 'SO-OLD' });
      const later = await createImportJobWithRow(a, t, {
        reportType: 'settlement_xlsx',
        fileSha256: 'c'.repeat(64),
      });
      const own = await entry(a, t, {
        subOrderNo: 'SO-NEW',
        importJobId: later.job.id,
        importRowId: later.row.id,
      });

      const scoped = await matcher.matchAndRecord(
        { workspaceId: a.workspace.id, sellerAccountId: a.account.id },
        {
          type: 'import',
          importJobId: later.job.id,
          reportType: 'settlement_xlsx',
          userId: a.user.id,
        },
        t,
      );
      expect((await reload(own, t)).matchMethod).toBe('auto');
      expect((await reload(older, t)).orderId).toBeNull();
      // Counts still describe the whole account.
      expect([
        scoped.matchedCount,
        scoped.unmatchedSettlementCount,
        scoped.unmatchedOrderCount,
      ]).toEqual([1, 1, 1]);

      const manual = await manualRun(a, t);
      expect((await reload(older, t)).matchMethod).toBe('auto');
      expect([manual.matchedCount, manual.unmatchedSettlementCount]).toEqual([
        1, 0,
      ]);
    }));

  it('an orders import run matches only entries waiting for orders IT created', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-scope-orders', t);
      const ordersJob = await createImportJobWithRow(a, t, {
        reportType: 'orders_csv',
        fileSha256: 'd'.repeat(64),
      });
      // SO-OLD was first imported by an earlier job; SO-NEW by this one.
      await createOrder(a, t, { subOrderNo: 'SO-OLD' });
      const created = await createOrder(a, t, {
        subOrderNo: 'SO-NEW',
        firstImportJobId: ordersJob.job.id,
        lastImportJobId: ordersJob.job.id,
        lastImportRowId: ordersJob.row.id,
      });
      const forOld = await entry(a, t, { subOrderNo: 'SO-OLD' });
      const forNew = await entry(a, t, { subOrderNo: 'SO-NEW' });
      const forNewRepeat = await entry(a, t, { subOrderNo: 'SO-NEW' });

      const scoped = await matcher.matchAndRecord(
        { workspaceId: a.workspace.id, sellerAccountId: a.account.id },
        {
          type: 'import',
          importJobId: ordersJob.job.id,
          reportType: 'orders_csv',
          userId: a.user.id,
        },
        t,
      );
      for (const e of [forNew, forNewRepeat]) {
        expect((await reload(e, t)).orderId).toBe(created.id);
      }
      expect((await reload(forOld, t)).orderId).toBeNull();
      expect([scoped.matchedCount, scoped.unmatchedSettlementCount]).toEqual([
        2, 1,
      ]);
      expect((await manualRun(a, t)).matchedCount).toBe(1);
    }));

  it('a manual run records no import job', () =>
    inRollback(sequelize, async (t) => {
      const a = await seedTenant('match-manual-run', t);
      const runRow = await matcher.matchAndRecord(
        { workspaceId: a.workspace.id, sellerAccountId: a.account.id },
        { type: 'manual', userId: a.user.id },
        t,
      );
      expect([
        runRow.triggerType,
        runRow.importJobId,
        runRow.matchedCount,
      ]).toEqual(['manual', null, 0]);
    }));
});
