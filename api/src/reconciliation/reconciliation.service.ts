import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import {
  ACCOUNT_BUSY_MESSAGE,
  inAccountTransaction,
} from '../authorization/account-transaction';
import {
  WorkspaceAccessService,
  type AccountAccess,
} from '../authorization/workspace-access.service';
import { ApiException } from '../common/errors/api.exception';
import { listWindow, type ListPageQueryDto } from '../common/http/list-query';
import {
  isoTimestamp,
  isoTimestampOrNull,
  toUserRef,
} from '../common/http/refs.dto';
import { scopeOf, type AccountScope } from '../common/sql/account-scope';
import { readSnapshot } from '../common/sql/read-snapshot';
import { moneyOrNull, toCount } from '../common/sql/values';
import { sanitizeError } from '../common/logging/error-sanitizer';
import {
  Order,
  ReconciliationRun,
  SettlementEntry,
  type ReconciliationRunStatus,
  type ReconciliationTriggerType,
} from '../database/models';
import type {
  OrderListDto,
  OrderStatusFilterQueryDto,
} from '../orders/dto/order.dto';
import {
  addStatusFilter,
  HAS_SETTLEMENT_SQL,
  orderOrderBy,
  orderScope,
  pageOfOrders,
  statusCounts,
} from '../orders/order-queries';
import { ORDER_NOT_FOUND_MESSAGE } from '../orders/orders.service';
import type {
  SettlementEntryDto,
  SettlementEntryPageDto,
  SettlementSortQueryDto,
} from '../settlements/dto/settlement.dto';
import {
  countEntries,
  entryOrderBy,
  entryScope,
  findEntry,
  MATCH_STATE_SQL,
  NOT_SUPERSEDED_SQL,
  selectEntries,
} from '../settlements/settlement-entry-queries';
import type {
  ManualMatchDto,
  ManualUnmatchDto,
  ReconciliationOverviewDto,
  RunListDto,
  RunSummaryDto,
} from './dto/reconciliation.dto';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';

export const ENTRY_NOT_FOUND_MESSAGE = 'Settlement entry not found.';
export const SUPERSEDED_ENTRY_MESSAGE =
  'This settlement entry has been superseded by a later entry and cannot be changed.';
export const ACCOUNT_LEVEL_ENTRY_MESSAGE =
  'This entry has no sub order number: it is an account-level entry (ads, referral, …) and cannot be matched to an order.';
export const NOT_MATCHED_MESSAGE =
  'This settlement entry is not matched to an order.';
export const RUN_ACCOUNT_DISABLED_MESSAGE =
  'This seller account is disabled: enable it before changing its reconciliation.';
export const RUN_FAILED_MESSAGE =
  'The matching run failed and nothing was changed. You can run it again.';
// The account-lock helper moved to authorization/account-transaction in M6 (products share it).
export { ACCOUNT_BUSY_MESSAGE };

/** A reconciliation_runs row joined with the user who triggered it. */
export interface RunRow {
  id: number | string;
  triggerType: ReconciliationTriggerType;
  status: ReconciliationRunStatus;
  importJobId: number | string | null;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  matchedCount: number | null;
  unmatchedSettlementCount: number | null;
  unmatchedOrderCount: number | null;
  failureMessage: string | null;
  triggeredById: number | string | null;
  triggeredByDisplayName: string | null;
  triggeredByEmail: string | null;
}

const RUN_SELECT = `SELECT r.id, r.trigger_type AS triggerType, r.status, r.import_job_id AS importJobId,
              r.started_at AS startedAt, r.finished_at AS finishedAt, r.matched_count AS matchedCount,
              r.unmatched_settlement_count AS unmatchedSettlementCount,
              r.unmatched_order_count AS unmatchedOrderCount, r.failure_message AS failureMessage,
              u.id AS triggeredById, u.display_name AS triggeredByDisplayName, u.email AS triggeredByEmail
       FROM reconciliation_runs r
       LEFT JOIN users u ON u.id = r.triggered_by_user_id
       WHERE r.seller_account_id = :sellerAccountId AND r.workspace_id = :workspaceId`;

const nullableCount = (value: number | null): number | null =>
  value === null ? null : toCount(value);

export function toRunSummaryDto(row: RunRow): RunSummaryDto {
  return {
    id: String(row.id),
    triggerType: row.triggerType,
    status: row.status,
    importJobId: row.importJobId === null ? null : String(row.importJobId),
    triggeredBy: toUserRef(
      row.triggeredById,
      row.triggeredByDisplayName,
      row.triggeredByEmail,
    ),
    startedAt: isoTimestamp(row.startedAt),
    finishedAt: isoTimestampOrNull(row.finishedAt),
    matchedCount: nullableCount(row.matchedCount),
    unmatchedSettlementCount: nullableCount(row.unmatchedSettlementCount),
    unmatchedOrderCount: nullableCount(row.unmatchedOrderCount),
    failureMessage: row.failureMessage,
  };
}

/** The account ids a run row belongs to. */
function account(run: ReconciliationRun): { id: number; workspaceId: number } {
  return { id: run.sellerAccountId, workspaceId: run.workspaceId };
}

/** Audit payload of a match change: the order id as a string (BIGINT) and the method. */
function matchAudit(entry: SettlementEntry): {
  orderId: string | null;
  matchMethod: string | null;
} {
  return {
    orderId: entry.orderId === null ? null : String(entry.orderId),
    matchMethod: entry.matchMethod,
  };
}

/**
 * Reconciliation of one seller account: overview, exceptions (unmatched settlements, orders without
 * settlement), runs, and manual (un)matching. Reads and runs: members; manual match / unmatch: owner.
 * Changes run in a READ COMMITTED transaction whose first statement locks the account row (the same lock
 * the import confirm takes), with audit rows in that transaction.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly matcher: ReconciliationMatcherService,
  ) {}

  async overview(
    userId: number,
    accountId: string,
  ): Promise<ReconciliationOverviewDto> {
    const scope = await this.scope(userId, accountId);
    return readSnapshot(this.sequelize, (transaction) =>
      this.overviewIn(scope, transaction),
    );
  }

  /** The overview's reads, all in the caller's snapshot transaction (so its numbers agree). */
  private async overviewIn(
    scope: AccountScope,
    transaction: Transaction,
  ): Promise<ReconciliationOverviewDto> {
    const [settlementRow] = await this.sequelize.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN ${MATCH_STATE_SQL.matched} THEN 1 END) AS matched,
              COUNT(CASE WHEN ${MATCH_STATE_SQL.unmatched} THEN 1 END) AS unmatched,
              COUNT(CASE WHEN ${MATCH_STATE_SQL.account_level} THEN 1 END) AS accountLevel,
              CAST(SUM(CASE WHEN ${MATCH_STATE_SQL.matched} THEN se.settlement_amount END) AS CHAR) AS matchedAmount,
              CAST(SUM(CASE WHEN ${MATCH_STATE_SQL.unmatched} THEN se.settlement_amount END) AS CHAR) AS unmatchedAmount,
              CAST(SUM(CASE WHEN ${MATCH_STATE_SQL.account_level} THEN se.settlement_amount END) AS CHAR) AS accountLevelAmount
       FROM settlement_entries se
       WHERE se.seller_account_id = :sellerAccountId AND se.workspace_id = :workspaceId
         AND ${NOT_SUPERSEDED_SQL}`,
      { type: QueryTypes.SELECT, replacements: { ...scope }, transaction },
    );
    const [orderRow] = await this.sequelize.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN ${HAS_SETTLEMENT_SQL} THEN 1 END) AS withSettlement
       FROM orders o
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId`,
      { type: QueryTypes.SELECT, replacements: { ...scope }, transaction },
    );
    const withoutFilter = orderScope(scope);
    withoutFilter.conditions.push(`NOT ${HAS_SETTLEMENT_SQL}`);
    const lastRun = await this.lastRun(scope, transaction);
    const withoutSettlementByStatus = await statusCounts(
      this.sequelize,
      withoutFilter,
      transaction,
    );
    const ordersTotal = toCount(orderRow?.total);
    const withSettlement = toCount(orderRow?.withSettlement);
    return {
      lastRun,
      settlements: {
        total: toCount(settlementRow?.total),
        matched: toCount(settlementRow?.matched),
        unmatched: toCount(settlementRow?.unmatched),
        accountLevel: toCount(settlementRow?.accountLevel),
        matchedAmount: moneyOrNull(settlementRow?.matchedAmount),
        unmatchedAmount: moneyOrNull(settlementRow?.unmatchedAmount),
        accountLevelAmount: moneyOrNull(settlementRow?.accountLevelAmount),
      },
      orders: {
        total: ordersTotal,
        withSettlement,
        withoutSettlement: ordersTotal - withSettlement,
      },
      withoutSettlementByStatus,
    };
  }

  /** Exception (a): entries with a sub order no, no order, not superseded. Account-level entries never. */
  async unmatchedSettlements(
    userId: number,
    accountId: string,
    query: SettlementSortQueryDto,
  ): Promise<SettlementEntryPageDto> {
    const scope = await this.scope(userId, accountId);
    const filter = entryScope(scope);
    filter.conditions.push(
      `(${MATCH_STATE_SQL.unmatched})`,
      NOT_SUPERSEDED_SQL,
    );
    const { limit, offset } = listWindow(query);
    const [items, total] = await readSnapshot(
      this.sequelize,
      async (transaction) =>
        [
          await selectEntries(this.sequelize, filter, {
            orderBy: entryOrderBy(query.sort),
            limit,
            offset,
            transaction,
          }),
          await countEntries(this.sequelize, filter, transaction),
        ] as const,
    );
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  /** Exception (b): orders with no matched, non-superseded entry; filterable by raw status. */
  async ordersWithoutSettlement(
    userId: number,
    accountId: string,
    query: OrderStatusFilterQueryDto,
  ): Promise<OrderListDto> {
    const scope = await this.scope(userId, accountId);
    const filter = orderScope(scope);
    addStatusFilter(filter, query.status);
    filter.conditions.push(`NOT ${HAS_SETTLEMENT_SQL}`);
    const { items, total } = await readSnapshot(this.sequelize, (transaction) =>
      pageOfOrders(
        this.sequelize,
        scope,
        filter,
        orderOrderBy(query.sort),
        listWindow(query),
        transaction,
      ),
    );
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async runs(
    userId: number,
    accountId: string,
    query: ListPageQueryDto,
  ): Promise<RunListDto> {
    const scope = await this.scope(userId, accountId);
    const { limit, offset } = listWindow(query);
    const [rows, total] = await readSnapshot(
      this.sequelize,
      async (transaction) =>
        [
          await this.sequelize.query<RunRow>(
            `${RUN_SELECT}
       ORDER BY r.started_at DESC, r.id DESC
       LIMIT :limit OFFSET :offset`,
            {
              type: QueryTypes.SELECT,
              replacements: { ...scope, limit, offset },
              transaction,
            },
          ),
          await ReconciliationRun.count({
            where: {
              sellerAccountId: scope.sellerAccountId,
              workspaceId: scope.workspaceId,
            },
            transaction,
          }),
        ] as const,
    );
    return {
      items: rows.map(toRunSummaryDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /**
   * "Run matching now" (members). A failure rolls the matching back and is recorded as a 'failed' run
   * (best effort) before the error is returned.
   */
  async runNow(actor: Actor, accountId: string): Promise<RunSummaryDto> {
    const resolved: { scope?: AccountScope } = {};
    const startedAt = new Date();
    let run: ReconciliationRun;
    try {
      run = await this.inAccountTransaction(
        actor,
        accountId,
        'member',
        async (account, transaction) => {
          resolved.scope = scopeOf(account);
          return this.matcher.matchAndRecord(
            resolved.scope,
            { type: 'manual', userId: actor.userId },
            transaction,
          );
        },
      );
    } catch (err) {
      // 4xx (no access, disabled account) are refusals, not failed runs.
      if (resolved.scope && !(err instanceof HttpException)) {
        await this.recordFailedRun(
          resolved.scope,
          actor.userId,
          startedAt,
          err,
        );
      }
      throw err;
    }
    this.logger.log(
      {
        event: 'reconciliation.run_completed',
        reconciliationRunId: run.id,
        sellerAccountId: run.sellerAccountId,
        triggerType: 'manual',
        matchedCount: run.matchedCount,
        unmatchedSettlementCount: run.unmatchedSettlementCount,
        unmatchedOrderCount: run.unmatchedOrderCount,
        durationMs: Date.now() - startedAt.getTime(),
      },
      'Reconciliation run completed',
    );
    return this.runById(scopeOf(account(run)), run.id);
  }

  /**
   * Owner only. Points the entry at the order (both must belong to this account, else 404), as a manual
   * match, and clears auto_match_blocked. Superseded entry → 409; an entry without a sub order no
   * (account-level) → 409; already matched to this order → 200 without a change. Audit
   * settlement_entry.matched with before/after { orderId, matchMethod }.
   */
  async manualMatch(
    actor: Actor,
    accountId: string,
    dto: ManualMatchDto,
  ): Promise<SettlementEntryDto> {
    return this.inAccountTransaction(
      actor,
      accountId,
      'owner',
      async (account, transaction) => {
        const scope = scopeOf(account);
        const entry = await this.lockEntry(
          scope,
          dto.settlementEntryId,
          transaction,
        );
        const order = await Order.findOne({
          attributes: ['id'],
          where: {
            id: dto.orderId,
            sellerAccountId: scope.sellerAccountId,
            workspaceId: scope.workspaceId,
          },
          transaction,
        });
        if (!order) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
        if (entry.supersededByEntryId !== null) {
          throw new ApiException('CONFLICT', SUPERSEDED_ENTRY_MESSAGE);
        }
        if (entry.subOrderNo === null) {
          throw new ApiException('CONFLICT', ACCOUNT_LEVEL_ENTRY_MESSAGE);
        }
        if (
          entry.orderId !== null &&
          String(entry.orderId) === String(order.id)
        ) {
          return this.entryDto(scope, entry.id, transaction);
        }
        const before = matchAudit(entry);
        const now = new Date();
        await entry.update(
          {
            orderId: order.id,
            matchMethod: 'manual',
            matchedAt: now,
            matchedByUserId: actor.userId,
            autoMatchBlocked: false,
          },
          { transaction },
        );
        await this.audit.record(
          {
            action: 'settlement_entry.matched',
            entityType: 'settlement_entry',
            entityId: entry.id,
            workspaceId: scope.workspaceId,
            sellerAccountId: scope.sellerAccountId,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            before,
            after: matchAudit(entry),
          },
          transaction,
        );
        return this.entryDto(scope, entry.id, transaction);
      },
    );
  }

  /**
   * Owner only. Removes the match (auto or manual) and sets auto_match_blocked so automatic matching does
   * not redo it. Not matched → 409; superseded → 409. Audit settlement_entry.unmatched.
   */
  async manualUnmatch(
    actor: Actor,
    accountId: string,
    dto: ManualUnmatchDto,
  ): Promise<SettlementEntryDto> {
    return this.inAccountTransaction(
      actor,
      accountId,
      'owner',
      async (account, transaction) => {
        const scope = scopeOf(account);
        const entry = await this.lockEntry(
          scope,
          dto.settlementEntryId,
          transaction,
        );
        if (entry.supersededByEntryId !== null) {
          throw new ApiException('CONFLICT', SUPERSEDED_ENTRY_MESSAGE);
        }
        if (entry.orderId === null) {
          throw new ApiException('CONFLICT', NOT_MATCHED_MESSAGE);
        }
        const before = matchAudit(entry);
        await entry.update(
          {
            orderId: null,
            matchMethod: null,
            matchedAt: null,
            matchedByUserId: null,
            autoMatchBlocked: true,
          },
          { transaction },
        );
        await this.audit.record(
          {
            action: 'settlement_entry.unmatched',
            entityType: 'settlement_entry',
            entityId: entry.id,
            workspaceId: scope.workspaceId,
            sellerAccountId: scope.sellerAccountId,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            before,
            after: matchAudit(entry),
          },
          transaction,
        );
        return this.entryDto(scope, entry.id, transaction);
      },
    );
  }

  /**
   * READ COMMITTED transaction whose FIRST statement locks the account row (and re-checks membership and
   * role): serialises it with imports and other matching changes of the account. Disabled account → 409.
   * Lock wait timeout (1205) or deadlock (1213) → 409 ACCOUNT_BUSY_MESSAGE (everything rolled back); a
   * manual run that hits it is a refusal, not a failed run. (Shared helper: authorization/account-transaction.)
   */
  private inAccountTransaction<T>(
    actor: Actor,
    accountId: string,
    minRole: 'member' | 'owner',
    work: (
      account: AccountAccess['account'],
      transaction: Transaction,
    ) => Promise<T>,
  ): Promise<T> {
    return inAccountTransaction(
      this.sequelize,
      this.access,
      actor,
      accountId,
      minRole,
      RUN_ACCOUNT_DISABLED_MESSAGE,
      work,
    );
  }

  /** The entry of THIS account, locked for the change; another account's id (or a missing one) → 404. */
  private async lockEntry(
    scope: AccountScope,
    entryId: string,
    transaction: Transaction,
  ): Promise<SettlementEntry> {
    const entry = await SettlementEntry.findOne({
      where: {
        id: entryId,
        sellerAccountId: scope.sellerAccountId,
        workspaceId: scope.workspaceId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!entry) throw new NotFoundException(ENTRY_NOT_FOUND_MESSAGE);
    return entry;
  }

  private async entryDto(
    scope: AccountScope,
    entryId: number,
    transaction: Transaction,
  ): Promise<SettlementEntryDto> {
    const dto = await findEntry(this.sequelize, scope, entryId, transaction);
    if (!dto) throw new Error(`settlement entry ${entryId} vanished`);
    return dto;
  }

  private async lastRun(
    scope: AccountScope,
    transaction: Transaction,
  ): Promise<RunSummaryDto | null> {
    const [row] = await this.sequelize.query<RunRow>(
      `${RUN_SELECT}
       ORDER BY r.started_at DESC, r.id DESC
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { ...scope }, transaction },
    );
    return row ? toRunSummaryDto(row) : null;
  }

  private async runById(
    scope: AccountScope,
    runId: number,
  ): Promise<RunSummaryDto> {
    const [row] = await this.sequelize.query<RunRow>(
      `${RUN_SELECT} AND r.id = :runId`,
      { type: QueryTypes.SELECT, replacements: { ...scope, runId } },
    );
    if (!row) throw new Error(`reconciliation run ${runId} vanished`);
    return toRunSummaryDto(row);
  }

  private async recordFailedRun(
    scope: AccountScope,
    userId: number,
    startedAt: Date,
    err: unknown,
  ): Promise<void> {
    this.logger.error(
      {
        event: 'reconciliation.run_failed',
        sellerAccountId: scope.sellerAccountId,
        err: sanitizeError(err),
      },
      'Reconciliation run failed; rolled back',
    );
    try {
      await ReconciliationRun.create({
        workspaceId: scope.workspaceId,
        sellerAccountId: scope.sellerAccountId,
        triggerType: 'manual',
        triggeredByUserId: userId,
        status: 'failed',
        startedAt,
        finishedAt: new Date(),
        failureMessage: RUN_FAILED_MESSAGE,
      });
    } catch (recordErr) {
      this.logger.error(
        {
          event: 'reconciliation.record_failed_run_failed',
          sellerAccountId: scope.sellerAccountId,
          err: sanitizeError(recordErr),
        },
        'Could not record the failed reconciliation run',
      );
    }
  }

  private async scope(
    userId: number,
    accountId: string,
  ): Promise<AccountScope> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    return scopeOf(account);
  }
}
