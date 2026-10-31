import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import {
  Op,
  Transaction,
  UniqueConstraintError,
  type WhereOptions,
} from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { ApiException } from '../common/errors/api.exception';
import { sanitizeError } from '../common/logging/error-sanitizer';
import {
  ImportJob,
  ImportRow,
  Order,
  OrderStatusEvent,
  SettlementEntry,
  type ImportRowAction,
  type SellerAccountStatus,
  type SettlementEntryType,
} from '../database/models';
import type { ConfirmImportDto, ImportDetailDto } from './dto/import.dto';
import { staleImportingCutoff } from './import-actions';
import {
  ACCOUNT_DISABLED_MESSAGE,
  duplicateFileException,
  findActiveDuplicate,
  ImportsService,
} from './imports.service';
import { ReconciliationMatcherService } from '../reconciliation/reconciliation-matcher.service';
import { FINGERPRINT_VERSION } from './parsing/fingerprint';
import type { RowValues } from './parsing/parsed-report';
import {
  BATCH_SIZE,
  findExistingFingerprints,
  findExistingOrders,
} from './planning/import-lookups';
import { planOrder, type OrderValues } from './planning/order-plan';

export const IMPORT_FAILED_CODE = 'IMPORT_FAILED';
export const IMPORT_FAILED_MESSAGE =
  'The import failed and nothing was saved. You can retry it.';
export const NO_VALID_ROWS_MESSAGE = 'The file has no valid rows to import.';

/** Order columns written on insert and on update (ON DUPLICATE KEY UPDATE); never workspace/first job/created. */
const ORDER_UPSERT_FIELDS = [
  'orderNo',
  'orderDate',
  'sku',
  'catalogId',
  'productName',
  'size',
  'quantity',
  'customerState',
  'supplierListedPrice',
  'supplierDiscountedPrice',
  'packetId',
  'currentStatus',
  'currentStatusObservedAt',
  'lastImportJobId',
  'lastImportRowId',
  'updatedAt',
] as const;

interface ImportCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  historyOnly: number;
  statusEvents: number;
}

const zeroCounts = (): ImportCounts => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  historyOnly: 0,
  statusEvents: 0,
});

function parseValues(value: unknown): RowValues {
  if (typeof value === 'string') return JSON.parse(value) as RowValues;
  return (value ?? {}) as RowValues;
}

function orderColumns(values: OrderValues) {
  return {
    orderNo: values.orderNo,
    orderDate: values.orderDate as string,
    sku: values.sku,
    catalogId: values.catalogId,
    productName: values.productName,
    size: values.size,
    quantity: Number(values.quantity),
    customerState: values.customerState,
    supplierListedPrice: values.supplierListedPrice,
    supplierDiscountedPrice: values.supplierDiscountedPrice,
    packetId: values.packetId,
    currentStatus: values.currentStatus,
  };
}

/**
 * Confirm and retry: turns the staged valid rows of a job into orders + status events, or settlement
 * entries, in ONE transaction. That transaction runs at READ COMMITTED and its very first statement locks
 * the seller account row FOR UPDATE, so imports of one account run one at a time and a confirm that waited
 * for another sees everything the other committed (no stale snapshot that would plan inserts for existing
 * orders or re-insert known fingerprints). Any failure rolls everything back and leaves the job 'failed'
 * (retryable). The job is moved to 'importing' first, in its own statement, so the active-file unique key
 * refuses a second import of the same file; a crash after that point leaves it 'importing', which may be
 * retried or cancelled once it is stale (15 minutes after confirmed_at).
 * Milestone 5: after the job's rows are written (orders OR settlements: either side may arrive first) the
 * settlement ↔ order matcher runs in the SAME transaction, under the same account lock, and records a
 * reconciliation_runs row with trigger 'import'; a failing match rolls the whole import back.
 */
@Injectable()
export class ImportCommitService {
  private readonly logger = new Logger(ImportCommitService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly imports: ImportsService,
    private readonly matcher: ReconciliationMatcherService,
  ) {}

  async confirm(
    actor: Actor,
    importId: string,
    dto: ConfirmImportDto,
  ): Promise<ImportDetailDto> {
    const job = await this.loadForCommit(actor, importId);
    if (job.status !== 'previewed') {
      throw wrongStatus(job.status, 'confirmed', 'a previewed');
    }
    if (!job.validRows)
      throw new ApiException('CONFLICT', NO_VALID_ROWS_MESSAGE);
    const errorRows = job.errorRows ?? 0;
    if (errorRows > 0 && dto.skipErrorRows !== true) {
      throw new ApiException(
        'CONFLICT',
        `${errorRows} row(s) have errors and would be skipped.`,
        [
          {
            field: 'skipErrorRows',
            reasons: [
              'Confirm with skipErrorRows: true to import the valid rows and skip the rows with errors',
            ],
          },
        ],
      );
    }
    const claimedAt = await this.claim(job, { status: 'previewed' }, actor);
    await this.run(job, actor, false, claimedAt);
    return this.imports.detailById(job.id);
  }

  /**
   * failed (or importing for more than 15 minutes: a crashed run) → importing → completed. Error rows
   * were acknowledged at confirm, so they are skipped again.
   */
  async retry(actor: Actor, importId: string): Promise<ImportDetailDto> {
    const job = await this.loadForCommit(actor, importId);
    const cutoff = staleImportingCutoff();
    const stale =
      job.status === 'importing' &&
      job.confirmedAt !== null &&
      job.confirmedAt < cutoff;
    if (job.status !== 'failed' && !stale) {
      throw wrongStatus(job.status, 'retried', 'a failed (or stale importing)');
    }
    const claimedAt = await this.claim(
      job,
      {
        [Op.or]: [
          { status: 'failed' },
          { status: 'importing', confirmedAt: { [Op.lt]: cutoff } },
        ],
      },
      actor,
    );
    await this.run(job, actor, true, claimedAt);
    return this.imports.detailById(job.id);
  }

  private async loadForCommit(
    actor: Actor,
    importId: string,
  ): Promise<ImportJob> {
    const access = await this.access.requireImportJob(
      actor.userId,
      importId,
      'member',
    );
    assertActive(access.accountStatus);
    const job = await ImportJob.findByPk(access.importJob.id);
    if (!job) throw new Error(`import job ${access.importJob.id} vanished`);
    return job;
  }

  /**
   * Conditional → importing. The active-file unique key turns a second import of the file into 409.
   * Returns the confirmed_at it wrote: the claim token. Only the run holding the current token may complete
   * (or fail) the job, so a run that lost its claim to a stale retry / cancel rolls back.
   */
  private async claim(
    job: ImportJob,
    from: WhereOptions<ImportJob>,
    actor: Actor,
  ): Promise<Date> {
    const claimedAt = new Date();
    let affected: number;
    try {
      [affected] = await ImportJob.update(
        {
          status: 'importing',
          confirmedByUserId: actor.userId,
          confirmedAt: claimedAt,
          failureCode: null,
          failureMessage: null,
        },
        { where: { [Op.and]: [{ id: job.id }, from] } },
      );
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        const earlier = await findActiveDuplicate(
          job.sellerAccountId,
          job.reportType,
          job.fileSha256,
          job.id,
        );
        throw earlier
          ? duplicateFileException(earlier.id)
          : new ApiException(
              'CONFLICT',
              'This file is already being imported for this account.',
            );
      }
      throw err;
    }
    if (affected === 0) {
      throw new ApiException(
        'CONFLICT',
        'This import was changed by another request; reload it.',
      );
    }
    return claimedAt;
  }

  private async run(
    claimed: ImportJob,
    actor: Actor,
    retry: boolean,
    claimedAt: Date,
  ): Promise<void> {
    const started = Date.now();
    const jobId = claimed.id;
    const sellerAccountId = claimed.sellerAccountId;
    try {
      const counts = await this.sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (transaction) => {
          // FIRST statement: lock the account row (serialises imports per account, re-checks membership).
          // No read may come before it, so everything below sees the latest committed data.
          const { account } = await this.access.requireAccount(
            actor.userId,
            String(sellerAccountId),
            'member',
            { transaction, lock: true },
          );
          assertActive(account.status);
          const job = await ImportJob.findByPk(jobId, { transaction });
          if (!ownsClaim(job, claimedAt)) {
            throw new Error(
              `import job ${jobId} is no longer claimed by this run`,
            );
          }

          const result =
            job.reportType === 'orders_csv'
              ? await this.importOrders(job, transaction)
              : await this.importSettlements(job, transaction);
          const [skipped] = await ImportRow.update(
            { status: 'skipped' },
            { where: { importJobId: job.id, status: 'error' }, transaction },
          );
          const [completed] = await ImportJob.update(
            {
              status: 'completed',
              completedAt: new Date(),
              insertedCount: result.inserted,
              updatedCount: result.updated,
              unchangedCount: result.unchanged,
              historyOnlyCount: result.historyOnly,
            },
            {
              where: {
                id: job.id,
                status: 'importing',
                confirmedAt: claimedAt,
              },
              transaction,
            },
          );
          // The job was cancelled or re-claimed (stale retry) while this run worked: undo everything.
          if (completed !== 1) {
            throw new Error(
              `import job ${jobId} lost its claim before completing`,
            );
          }
          // After every write of this import: match what this job can newly match (account still locked).
          const reconciliation = await this.matcher.matchAndRecord(
            {
              workspaceId: job.workspaceId,
              sellerAccountId: job.sellerAccountId,
            },
            {
              type: 'import',
              importJobId: job.id,
              reportType: job.reportType,
              userId: actor.userId,
            },
            transaction,
          );
          await this.audit.record(
            {
              action: 'import.confirmed',
              entityType: 'import_job',
              entityId: job.id,
              workspaceId: job.workspaceId,
              sellerAccountId: job.sellerAccountId,
              actorUserId: actor.userId,
              requestId: actor.requestId,
              after: {
                reportType: job.reportType,
                insertedCount: result.inserted,
                updatedCount: result.updated,
                unchangedCount: result.unchanged,
                historyOnlyCount: result.historyOnly,
                statusEvents: result.statusEvents,
                skippedRows: skipped,
                retry,
              },
            },
            transaction,
          );
          return {
            ...result,
            skipped,
            reconciliationRunId: reconciliation.id,
            autoMatched: reconciliation.matchedCount,
          };
        },
      );
      this.logger.log(
        {
          event: 'import.completed',
          importJobId: jobId,
          sellerAccountId,
          ...counts,
          retry,
          durationMs: Date.now() - started,
        },
        'Import completed',
      );
    } catch (err) {
      this.logger.error(
        {
          event: 'import.failed',
          importJobId: jobId,
          sellerAccountId,
          err: sanitizeError(err),
          durationMs: Date.now() - started,
        },
        'Import failed; rolled back',
      );
      await this.markFailed(jobId, claimedAt);
      throw err;
    }
  }

  /** Only while this run still holds the claim: a cancelled or re-claimed job is left as it is. */
  private async markFailed(jobId: number, claimedAt: Date): Promise<void> {
    try {
      await ImportJob.update(
        {
          status: 'failed',
          failureCode: IMPORT_FAILED_CODE,
          failureMessage: IMPORT_FAILED_MESSAGE,
        },
        { where: { id: jobId, status: 'importing', confirmedAt: claimedAt } },
      );
    } catch (err) {
      // The job stays 'importing' (retryable once stale); the original error is still reported.
      this.logger.error(
        {
          event: 'import.mark_failed_failed',
          importJobId: jobId,
          err: sanitizeError(err),
        },
        'Could not mark the import as failed',
      );
    }
  }

  /** Valid staged rows of the job in file order, BATCH_SIZE at a time (keyset by id). */
  private async *validRowBatches(
    jobId: number,
    transaction: Transaction,
  ): AsyncGenerator<{ row: ImportRow; values: RowValues }[]> {
    let lastId = 0;
    for (;;) {
      const rows = await ImportRow.findAll({
        where: { importJobId: jobId, status: 'valid', id: { [Op.gt]: lastId } },
        order: [['id', 'ASC']],
        limit: BATCH_SIZE,
        transaction,
      });
      if (rows.length === 0) return;
      lastId = rows[rows.length - 1].id;
      yield rows.map((row) => ({ row, values: parseValues(row.sourceValues) }));
    }
  }

  private async markRowsImported(
    byAction: Map<ImportRowAction, number[]>,
    transaction: Transaction,
  ): Promise<void> {
    for (const [action, ids] of byAction) {
      if (ids.length === 0) continue;
      await ImportRow.update(
        { status: 'imported', action },
        { where: { id: { [Op.in]: ids } }, transaction },
      );
    }
  }

  /**
   * Orders: upsert by (account, sub-order no) for insert / update / unchanged (the observation time and
   * source row move forward), nothing for status_event (older report: history only); then one status
   * event per row, observed at the job's data_as_of.
   */
  private async importOrders(
    job: ImportJob,
    transaction: Transaction,
  ): Promise<ImportCounts> {
    const counts = zeroCounts();
    const observedAt = job.dataAsOf ?? job.createdAt;
    for await (const batch of this.validRowBatches(job.id, transaction)) {
      const subOrderNos = batch.map(
        ({ values }) => values.subOrderNo as string,
      );
      const existing = await findExistingOrders(
        job.sellerAccountId,
        subOrderNos,
        transaction,
      );
      const byAction = new Map<ImportRowAction, number[]>();
      const upserts = [];
      for (const { row, values } of batch) {
        const current = existing.get(values.subOrderNo as string);
        const plan = planOrder(current, values, observedAt);
        const ids = byAction.get(plan.action) ?? [];
        ids.push(row.id);
        byAction.set(plan.action, ids);
        if (plan.action === 'insert') counts.inserted += 1;
        else if (plan.action === 'update') counts.updated += 1;
        else if (plan.action === 'status_event') counts.historyOnly += 1;
        else counts.unchanged += 1;
        if (plan.values) {
          upserts.push({
            workspaceId: job.workspaceId,
            sellerAccountId: job.sellerAccountId,
            subOrderNo: values.subOrderNo as string,
            ...orderColumns(plan.values),
            currentStatusObservedAt: observedAt,
            firstImportJobId: current?.firstImportJobId ?? job.id,
            lastImportJobId: job.id,
            lastImportRowId: row.id,
          });
        }
      }
      if (upserts.length > 0) {
        await Order.bulkCreate(upserts, {
          transaction,
          updateOnDuplicate: [...ORDER_UPSERT_FIELDS],
        });
      }
      // Ids are read back rather than taken from the bulk insert (updated rows report no new id).
      const orders = await Order.findAll({
        attributes: ['id', 'subOrderNo'],
        where: {
          sellerAccountId: job.sellerAccountId,
          subOrderNo: { [Op.in]: subOrderNos },
        },
        transaction,
      });
      const orderIds = new Map(orders.map((o) => [o.subOrderNo, o.id]));
      await OrderStatusEvent.bulkCreate(
        batch.map(({ row, values }) => {
          const orderId = orderIds.get(values.subOrderNo as string);
          if (orderId === undefined) {
            throw new Error('order missing after upsert');
          }
          return {
            workspaceId: job.workspaceId,
            sellerAccountId: job.sellerAccountId,
            orderId,
            status: values.status as string,
            observedAt,
            importJobId: job.id,
            importRowId: row.id,
          };
        }),
        { transaction },
      );
      counts.statusEvents += batch.length;
      await this.markRowsImported(byAction, transaction);
    }
    return counts;
  }

  /** Settlements: insert by fingerprint; a fingerprint the account already has → unchanged. */
  private async importSettlements(
    job: ImportJob,
    transaction: Transaction,
  ): Promise<ImportCounts> {
    const counts = zeroCounts();
    for await (const batch of this.validRowBatches(job.id, transaction)) {
      const known = await findExistingFingerprints(
        job.sellerAccountId,
        batch.map(({ row }) => row.rowHash as string),
        transaction,
      );
      const inserted: number[] = [];
      const unchanged: number[] = [];
      const entries = [];
      for (const { row, values } of batch) {
        const fingerprint = row.rowHash as string;
        if (known.has(fingerprint)) {
          unchanged.push(row.id);
          continue;
        }
        inserted.push(row.id);
        entries.push({
          workspaceId: job.workspaceId,
          sellerAccountId: job.sellerAccountId,
          importJobId: job.id,
          importRowId: row.id,
          sheetName: row.sheetName,
          entryType: values.entryType as SettlementEntryType,
          transactionId: values.transactionId ?? null,
          subOrderNo: values.subOrderNo ?? null,
          orderDate: values.orderDate ?? null,
          paymentDate: values.paymentDate ?? null,
          settlementAmount: values.settlementAmount as string,
          saleAmount: values.saleAmount ?? null,
          returnAmount: values.returnAmount ?? null,
          commissionAmount: values.commissionAmount ?? null,
          shippingCharge: values.shippingCharge ?? null,
          tcsAmount: values.tcsAmount ?? null,
          tdsAmount: values.tdsAmount ?? null,
          recoveryAmount: values.recoveryAmount ?? null,
          compensationAmount: values.compensationAmount ?? null,
          // No reliable estimate indicator in the known sheets yet.
          isEstimate: false,
          entryFingerprint: fingerprint,
          fingerprintVersion: FINGERPRINT_VERSION,
        });
      }
      if (entries.length > 0) {
        await SettlementEntry.bulkCreate(entries, { transaction });
      }
      counts.inserted += inserted.length;
      counts.unchanged += unchanged.length;
      await this.markRowsImported(
        new Map<ImportRowAction, number[]>([
          ['insert', inserted],
          ['unchanged', unchanged],
        ]),
        transaction,
      );
    }
    return counts;
  }
}

/** The job is still 'importing' under the claim token this run wrote. */
function ownsClaim(job: ImportJob | null, claimedAt: Date): job is ImportJob {
  return (
    job !== null &&
    job.status === 'importing' &&
    job.confirmedAt !== null &&
    job.confirmedAt.getTime() === claimedAt.getTime()
  );
}

function assertActive(status: SellerAccountStatus): void {
  if (status !== 'active') {
    throw new ApiException('CONFLICT', ACCOUNT_DISABLED_MESSAGE);
  }
}

function wrongStatus(
  status: string,
  verb: string,
  needed: string,
): ApiException {
  return new ApiException(
    'CONFLICT',
    `This import is ${status}: only ${needed} import can be ${verb}.`,
  );
}
