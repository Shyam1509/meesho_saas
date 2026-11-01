import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Response } from 'express';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { ApiException } from '../common/errors/api.exception';
import {
  scopeOf,
  whereClause,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { readSnapshot } from '../common/sql/read-snapshot';
import { toCount } from '../common/sql/values';
import { AppConfigService } from '../config/app-config.service';
import {
  accountExpenseScope,
  addExpenseFilters,
  expenseOrderBy,
  selectExpenses,
  workspaceExpenseScope,
} from '../expenses/expense-queries';
import {
  FIRST_PAYMENT_DATE_SQL,
  ORDER_SUMMARY_COLUMNS,
  ORDER_SUMMARY_JOINS,
  orderOrderBy,
  settlementSummaries,
  toOrderSummaryDto,
  type OrderSummaryRow,
} from '../orders/order-queries';
import { orderListFilter } from '../orders/orders.service';
import {
  entryOrderBy,
  entryScope,
  selectEntries,
} from '../settlements/settlement-entry-queries';
import { settlementListFilter } from '../settlements/settlements.service';
import {
  CSV_BOM,
  csvContentDisposition,
  csvHeader,
  csvRow,
  type CsvColumn,
} from './csv';
import { ClientGoneError, CsvResponseWriter } from './csv-response';
import { ExportLimiter } from './export-limiter';
import type {
  ExpensesExportQueryDto,
  OrdersExportQueryDto,
  ReportType,
  SettlementsExportQueryDto,
  WorkspaceExpensesExportQueryDto,
} from './dto/report.dto';
import {
  EXPENSE_COLUMNS,
  ORDER_COLUMNS,
  SETTLEMENT_COLUMNS,
  type ExpenseExportRow,
  type OrderExportRow,
  type SettlementExportRow,
} from './report-columns';

/** Rows fetched (and written) per batch. */
export const EXPORT_BATCH_SIZE = 1000;

export const EXPORTS_BUSY_MESSAGE = 'Exports are busy, try again in a moment.';
/** Retry-After (seconds) sent with that 429. */
export const EXPORT_RETRY_AFTER_SECONDS = 5;

export function exportTooLargeMessage(rows: number, max: number): string {
  return `This export has ${rows} rows; at most ${max} rows can be exported at once. Narrow the filters (for example a shorter date range) and try again.`;
}

/** How to read one export: its count, its ordered ids, and its rows for a batch of ids. */
interface ExportPlan<Row> {
  type: ReportType;
  /** The download header (csvContentDisposition). */
  contentDisposition: string;
  columns: readonly CsvColumn<Row>[];
  /** `undefined`: outside a transaction (HEAD). */
  count: (transaction: Transaction | undefined) => Promise<number>;
  /** Every matching id in the list's sort order (at most `limit`). */
  ids: (transaction: Transaction, limit: number) => Promise<string[]>;
  /** The rows of `ids` (any order: they are put back in id order). */
  rows: (transaction: Transaction, ids: string[]) => Promise<Row[]>;
  idOf: (row: Row) => string;
  audit: Pick<
    AuditEntry,
    'entityType' | 'entityId' | 'workspaceId' | 'sellerAccountId'
  >;
  filters: Record<string, unknown>;
}

interface ExportRequest {
  actor: Actor;
  /** HEAD: only the count check and the headers (no rows, no audit). */
  headOnly: boolean;
  res: Response;
}

/** The query values that were actually given (for the audit row). */
function givenFilters(query: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

/** `rows` in the order of `ids` (rows of a batch come back in primary-key order). */
function inIdOrder<Row>(
  ids: readonly string[],
  rows: readonly Row[],
  idOf: (row: Row) => string,
): Row[] {
  const byId = new Map(rows.map((row) => [idOf(row), row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}

/**
 * CSV exports (Milestone 7, members): the rows of a list with the same filters and sort, streamed in batches.
 * Everything is read in ONE read-only snapshot: COUNT first (more than REPORT_MAX_ROWS → 422 before any
 * byte is sent), then the matching ids in list order (ids only, at most REPORT_MAX_ROWS), then the rows in
 * batches of 1000 by primary key, mapped by the list's own row mappers. An audit row `report.exported`
 * (type, filters, row count) is written before the first row.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly limiter: ExportLimiter,
  ) {}

  async orders(
    request: ExportRequest,
    accountId: string,
    query: OrdersExportQueryDto,
  ): Promise<void> {
    const { account } = await this.access.requireAccount(
      request.actor.userId,
      accountId,
      'member',
    );
    const scope = scopeOf(account);
    const filter = orderListFilter(scope, query);
    await this.run(request, {
      type: 'orders',
      contentDisposition: csvContentDisposition(account.displayName, 'orders', {
        from: query.from ?? query.paymentFrom,
        to: query.to ?? query.paymentTo,
      }),
      columns: ORDER_COLUMNS,
      count: (t) => this.count('orders o', filter, t),
      ids: (t, limit) =>
        this.ids(
          'o.id',
          'orders o',
          filter,
          orderOrderBy(query.sort),
          limit,
          t,
        ),
      rows: (t, ids) => this.orderRows(scope, ids, t),
      idOf: (row) => row.id,
      audit: {
        entityType: 'seller_account',
        entityId: account.id,
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
      },
      filters: givenFilters(query),
    });
  }

  async settlements(
    request: ExportRequest,
    accountId: string,
    query: SettlementsExportQueryDto,
  ): Promise<void> {
    const { account } = await this.access.requireAccount(
      request.actor.userId,
      accountId,
      'member',
    );
    const scope = scopeOf(account);
    const filter = settlementListFilter(scope, query);
    await this.run(request, {
      type: 'settlements',
      contentDisposition: csvContentDisposition(
        account.displayName,
        'settlements',
        query,
      ),
      columns: SETTLEMENT_COLUMNS,
      count: (t) => this.count('settlement_entries se', filter, t),
      ids: (t, limit) =>
        this.ids(
          'se.id',
          'settlement_entries se',
          filter,
          entryOrderBy(query.sort),
          limit,
          t,
        ),
      rows: (t, ids) => this.settlementRows(scope, ids, t),
      idOf: (row) => row.id,
      audit: {
        entityType: 'seller_account',
        entityId: account.id,
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
      },
      filters: givenFilters(query),
    });
  }

  async accountExpenses(
    request: ExportRequest,
    accountId: string,
    query: ExpensesExportQueryDto,
  ): Promise<void> {
    const { account } = await this.access.requireAccount(
      request.actor.userId,
      accountId,
      'member',
    );
    const filter = addExpenseFilters(accountExpenseScope(account), query);
    await this.run(request, {
      ...this.expensePlan(account.workspaceId, filter, query),
      contentDisposition: csvContentDisposition(
        account.displayName,
        'expenses',
        query,
      ),
      audit: {
        entityType: 'seller_account',
        entityId: account.id,
        workspaceId: account.workspaceId,
        sellerAccountId: account.id,
      },
    });
  }

  async workspaceExpenses(
    request: ExportRequest,
    workspaceId: string,
    query: WorkspaceExpensesExportQueryDto,
  ): Promise<void> {
    const { workspace } = await this.access.requireWorkspace(
      request.actor.userId,
      workspaceId,
      'member',
    );
    const filter = addExpenseFilters(
      workspaceExpenseScope(workspace.id, query.scope),
      query,
    );
    await this.run(request, {
      ...this.expensePlan(workspace.id, filter, query),
      contentDisposition: csvContentDisposition(
        workspace.name,
        'expenses',
        query,
      ),
      audit: {
        entityType: 'workspace',
        entityId: workspace.id,
        workspaceId: workspace.id,
        sellerAccountId: null,
      },
    });
  }

  private expensePlan(
    workspaceId: number,
    filter: SqlFilter,
    query: ExpensesExportQueryDto,
  ): Omit<ExportPlan<ExpenseExportRow>, 'contentDisposition' | 'audit'> {
    return {
      type: 'expenses',
      columns: EXPENSE_COLUMNS,
      count: (t) => this.count('expenses e', filter, t),
      ids: (t, limit) =>
        this.ids(
          'e.id',
          'expenses e',
          filter,
          expenseOrderBy(query.sort),
          limit,
          t,
        ),
      rows: (t, ids) => this.expenseRows(workspaceId, ids, t),
      idOf: (row) => row.id,
      filters: givenFilters(query),
    };
  }

  /**
   * One export, holding at most ONE pooled connection at a time:
   * 1. a slot of the process-wide ExportLimiter (none free → 429, nothing read);
   * 2. a short write transaction: COUNT (over the cap → 422, rolled back, no audit) + the audit row;
   * 3. the read-only snapshot: COUNT again (rows imported meanwhile may push it over the cap → 422 before any
   *    byte, no partial file), then the ids and the rows in batches, streamed with a stall timeout.
   * HEAD: only the count (no slot, no audit, no rows).
   */
  private async run<Row>(
    request: ExportRequest,
    plan: ExportPlan<Row>,
  ): Promise<void> {
    const max = this.config.reportMaxRows;
    const tooLarge = (rows: number) =>
      new ApiException('EXPORT_TOO_LARGE', exportTooLargeMessage(rows, max));
    const writer = new CsvResponseWriter(
      request.res,
      this.config.reportStallTimeoutMs,
    );
    if (request.headOnly) {
      const rows = await plan.count(undefined);
      if (rows > max) throw tooLarge(rows);
      writer.start(plan.contentDisposition);
      writer.end();
      return;
    }
    const release = this.limiter.tryAcquire();
    if (!release) {
      request.res.setHeader('Retry-After', String(EXPORT_RETRY_AFTER_SECONDS));
      throw new ApiException('RATE_LIMITED', EXPORTS_BUSY_MESSAGE);
    }
    try {
      const total = await this.sequelize.transaction(async (transaction) => {
        const rows = await plan.count(transaction);
        if (rows > max) throw tooLarge(rows);
        await this.audit.record(
          {
            action: 'report.exported',
            ...plan.audit,
            actorUserId: request.actor.userId,
            requestId: request.actor.requestId,
            after: { type: plan.type, filters: plan.filters, rowCount: rows },
          },
          transaction,
        );
        return rows;
      });
      await readSnapshot(this.sequelize, async (transaction) => {
        const rows = await plan.count(transaction);
        if (rows > max) throw tooLarge(rows);
        writer.start(plan.contentDisposition);
        await writer.write(CSV_BOM + csvHeader(plan.columns));
        const ids = await plan.ids(transaction, Math.max(total, rows));
        for (let i = 0; i < ids.length; i += EXPORT_BATCH_SIZE) {
          const batch = ids.slice(i, i + EXPORT_BATCH_SIZE);
          const batchRows = inIdOrder(
            batch,
            await plan.rows(transaction, batch),
            plan.idOf,
          );
          await writer.write(
            batchRows.map((row) => csvRow(plan.columns, row)).join(''),
          );
        }
        writer.end();
      });
    } catch (err) {
      // A client that left (or stalled and was cut off) gets nothing more; the snapshot was rolled back.
      if (err instanceof ClientGoneError) return;
      throw err;
    } finally {
      release();
    }
  }

  private async count(
    table: string,
    filter: SqlFilter,
    transaction: Transaction | undefined,
  ): Promise<number> {
    const [row] = await this.sequelize.query<{ total: unknown }>(
      `SELECT COUNT(*) AS total FROM ${table} ${whereClause(filter)}`,
      {
        type: QueryTypes.SELECT,
        replacements: filter.replacements,
        transaction,
      },
    );
    return toCount(row?.total);
  }

  private async ids(
    idColumn: string,
    table: string,
    filter: SqlFilter,
    orderBy: string,
    limit: number,
    transaction: Transaction,
  ): Promise<string[]> {
    const rows = await this.sequelize.query<{ id: number | string }>(
      `SELECT ${idColumn} AS id FROM ${table}
       ${whereClause(filter)}
       ORDER BY ${orderBy}
       LIMIT :exportLimit`,
      {
        type: QueryTypes.SELECT,
        replacements: { ...filter.replacements, exportLimit: limit },
        transaction,
      },
    );
    return rows.map((row) => String(row.id));
  }

  /** Order list items (the list's columns, cost and settlement summary) + first payment date + source file. */
  private async orderRows(
    scope: AccountScope,
    ids: string[],
    transaction: Transaction,
  ): Promise<OrderExportRow[]> {
    const rows = await this.sequelize.query<
      OrderSummaryRow & {
        firstPaymentDate: string | null;
        sourceImportId: number | string;
        sourceImportFile: string;
      }
    >(
      `SELECT ${ORDER_SUMMARY_COLUMNS},
              CAST(${FIRST_PAYMENT_DATE_SQL} AS CHAR) AS firstPaymentDate,
              lj.id AS sourceImportId, lj.original_filename AS sourceImportFile
       FROM orders o
       JOIN import_jobs lj ON lj.seller_account_id = o.seller_account_id AND lj.id = o.last_import_job_id
       ${ORDER_SUMMARY_JOINS}
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND o.id IN (:ids)`,
      {
        type: QueryTypes.SELECT,
        replacements: { ...scope, ids },
        transaction,
      },
    );
    const summaries = await settlementSummaries(
      this.sequelize,
      scope,
      ids,
      transaction,
    );
    return rows.map((row) => ({
      ...toOrderSummaryDto(
        row,
        summaries.get(String(row.id)) ?? { entryCount: 0, amount: null },
      ),
      firstPaymentDate: row.firstPaymentDate,
      sourceImportId: String(row.sourceImportId),
      sourceImportFile: row.sourceImportFile,
    }));
  }

  /** Settlement list items + the matched order's order date (the entry's order-date-basis date). */
  private async settlementRows(
    scope: AccountScope,
    ids: string[],
    transaction: Transaction,
  ): Promise<SettlementExportRow[]> {
    const filter = entryScope(scope);
    filter.conditions.push('se.id IN (:ids)');
    filter.replacements.ids = ids;
    const entries = await selectEntries(this.sequelize, filter, {
      orderBy: 'se.id ASC',
      transaction,
    });
    const orderIds = [
      ...new Set(
        entries.flatMap((e) => (e.match.orderId ? [e.match.orderId] : [])),
      ),
    ];
    const orderDates = new Map<string, string>();
    if (orderIds.length > 0) {
      const rows = await this.sequelize.query<{
        id: number | string;
        orderDate: string;
      }>(
        `SELECT o.id, CAST(o.order_date AS CHAR) AS orderDate FROM orders o
         WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
           AND o.id IN (:orderIds)`,
        {
          type: QueryTypes.SELECT,
          replacements: { ...scope, orderIds },
          transaction,
        },
      );
      for (const row of rows) orderDates.set(String(row.id), row.orderDate);
    }
    return entries.map((entry) => ({
      ...entry,
      matchedOrderDate: entry.match.orderId
        ? (orderDates.get(entry.match.orderId) ?? null)
        : null,
    }));
  }

  /** Expense list items + the seller account's name (null for a workspace-wide expense). */
  private async expenseRows(
    workspaceId: number,
    ids: string[],
    transaction: Transaction,
  ): Promise<ExpenseExportRow[]> {
    const expenses = await selectExpenses(
      this.sequelize,
      {
        conditions: ['e.workspace_id = :workspaceId', 'e.id IN (:ids)'],
        replacements: { workspaceId, ids },
      },
      { orderBy: 'e.id ASC', transaction },
    );
    const accounts = await this.sequelize.query<{
      id: number | string;
      displayName: string;
    }>(
      `SELECT a.id, a.display_name AS displayName FROM seller_accounts a
       WHERE a.workspace_id = :workspaceId`,
      { type: QueryTypes.SELECT, replacements: { workspaceId }, transaction },
    );
    const names = new Map(accounts.map((a) => [String(a.id), a.displayName]));
    return expenses.map((expense) => ({
      ...expense,
      sellerAccountName:
        expense.sellerAccountId === null
          ? null
          : (names.get(expense.sellerAccountId) ?? null),
    }));
  }
}
