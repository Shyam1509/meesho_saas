import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { AccountScope } from '../common/sql/account-scope';
import { utcDatetime } from '../common/sql/datetime';
import { toCount } from '../common/sql/values';
import { ReconciliationRun, type ImportReportType } from '../database/models';
import { HAS_SETTLEMENT_SQL } from '../orders/order-queries';
import {
  MATCH_STATE_SQL,
  NOT_SUPERSEDED_SQL,
} from '../settlements/settlement-entry-queries';

/** What started a run: an import confirm (names its job and report type) or "Run matching now". */
export type RunTrigger =
  | {
      type: 'import';
      importJobId: number;
      reportType: ImportReportType;
      userId: number | null;
    }
  | { type: 'manual'; userId: number };

/**
 * An entry auto-match may take: unmatched (has a sub order no, no order — so an existing manual or auto
 * match is never touched or re-pointed), not superseded, not blocked by a manual unmatch. The same
 * fragments as the exception lists and the overview.
 */
export const AUTO_MATCH_CANDIDATE_SQL = `(${MATCH_STATE_SQL.unmatched})
         AND ${NOT_SUPERSEDED_SQL}
         AND se.auto_match_blocked = 0`;

/**
 * The automatic matching rule as one UPDATE: a candidate entry of the account gets the order of the SAME
 * account with the SAME sub order no (both utf8mb4_bin: exact, case-sensitive). orders
 * (seller_account_id, sub_order_no) is unique, so an entry joins at most one order. `extra` narrows the
 * rows an import run looks at (see AUTO_MATCH_SQL_BY_TRIGGER).
 */
function autoMatchSql(extra = ''): string {
  return `UPDATE settlement_entries se
       JOIN orders o ON o.seller_account_id = se.seller_account_id AND o.sub_order_no = se.sub_order_no
       SET se.order_id = o.id, se.match_method = 'auto', se.matched_at = :now,
           se.matched_by_user_id = NULL, se.updated_at = :now
       WHERE se.seller_account_id = :sellerAccountId AND se.workspace_id = :workspaceId
         AND o.workspace_id = :workspaceId${extra}
         AND ${AUTO_MATCH_CANDIDATE_SQL}`;
}

/** Manual run: every candidate entry of the account. */
export const AUTO_MATCH_SQL = autoMatchSql();

/**
 * Import runs touch only what THIS job can newly match (an earlier confirm already matched everything that
 * was matchable before it):
 * - settlement import: its own new entries (`import_job_id`, index (seller_account_id, import_job_id));
 * - orders import: entries waiting for an order this job created (`first_import_job_id`, index
 *   (seller_account_id, first_import_job_id)); orders it only updated existed at earlier confirms.
 * Entries left unmatched by older code, or by a block later lifted, are picked up by a manual run.
 */
export const AUTO_MATCH_SQL_BY_TRIGGER: Readonly<
  Record<ImportReportType, string>
> = {
  settlement_xlsx: autoMatchSql(
    '\n         AND se.import_job_id = :importJobId',
  ),
  orders_csv: autoMatchSql(
    '\n         AND o.first_import_job_id = :importJobId',
  ),
};

/** Exceptions after a run, from the SAME fragments as the overview and the exception lists. */
export const EXCEPTION_COUNTS_SQL = `SELECT
         (SELECT COUNT(*) FROM settlement_entries se
           WHERE se.seller_account_id = :sellerAccountId AND se.workspace_id = :workspaceId
             AND (${MATCH_STATE_SQL.unmatched}) AND ${NOT_SUPERSEDED_SQL}) AS unmatchedSettlements,
         (SELECT COUNT(*) FROM orders o
           WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
             AND NOT ${HAS_SETTLEMENT_SQL}) AS unmatchedOrders`;

/**
 * Settlement ↔ order matching. `matchAndRecord` runs inside the CALLER's transaction, which must already
 * hold the seller account row lock (SELECT ... FOR UPDATE, as the import confirm and the reconciliation
 * service take first): every writer of an account's orders / entries / matches is serialised by that
 * lock, so a run never races an import or a manual (un)match. The run row commits or rolls back with the
 * caller's work.
 */
@Injectable()
export class ReconciliationMatcherService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async matchAndRecord(
    scope: AccountScope,
    trigger: RunTrigger,
    transaction: Transaction,
  ): Promise<ReconciliationRun> {
    const startedAt = new Date();
    const matchedCount = await this.autoMatch(
      scope,
      trigger,
      startedAt,
      transaction,
    );
    const counts = await this.exceptionCounts(scope, transaction);
    return ReconciliationRun.create(
      {
        workspaceId: scope.workspaceId,
        sellerAccountId: scope.sellerAccountId,
        triggerType: trigger.type,
        importJobId: trigger.type === 'import' ? trigger.importJobId : null,
        triggeredByUserId: trigger.userId,
        status: 'completed',
        startedAt,
        finishedAt: new Date(),
        matchedCount,
        unmatchedSettlementCount: counts.unmatchedSettlements,
        unmatchedOrderCount: counts.unmatchedOrders,
      },
      { transaction },
    );
  }

  /** Applies the trigger's UPDATE; returns how many entries it matched. */
  private async autoMatch(
    scope: AccountScope,
    trigger: RunTrigger,
    now: Date,
    transaction: Transaction,
  ): Promise<number> {
    const [sql, replacements] =
      trigger.type === 'import'
        ? [
            AUTO_MATCH_SQL_BY_TRIGGER[trigger.reportType],
            { importJobId: trigger.importJobId },
          ]
        : [AUTO_MATCH_SQL, {}];
    const [, affected] = await this.sequelize.query(sql, {
      type: QueryTypes.UPDATE,
      replacements: { ...scope, ...replacements, now: utcDatetime(now) },
      transaction,
    });
    return toCount(affected);
  }

  private async exceptionCounts(
    scope: AccountScope,
    transaction: Transaction,
  ): Promise<{ unmatchedSettlements: number; unmatchedOrders: number }> {
    const [row] = await this.sequelize.query<{
      unmatchedSettlements: unknown;
      unmatchedOrders: unknown;
    }>(EXCEPTION_COUNTS_SQL, {
      type: QueryTypes.SELECT,
      replacements: { ...scope },
      transaction,
    });
    return {
      unmatchedSettlements: toCount(row?.unmatchedSettlements),
      unmatchedOrders: toCount(row?.unmatchedOrders),
    };
  }
}
