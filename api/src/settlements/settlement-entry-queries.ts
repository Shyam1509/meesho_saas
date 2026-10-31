import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  isoTimestamp,
  isoTimestampOrNull,
  toImportRef,
  toUserRef,
} from '../common/http/refs.dto';
import { parseSort } from '../common/http/list-query';
import {
  whereClause,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { idOrNull, moneyOrNull, toBool, toCount } from '../common/sql/values';
import type {
  SettlementEntryType,
  SettlementMatchMethod,
} from '../database/models';
import type {
  SettlementEntryDto,
  SettlementMatchState,
  SettlementSort,
  SettlementSortKey,
} from './dto/settlement.dto';

/** One settlement_entries row joined with its import job, matched order and matching user. */
export interface SettlementEntryRow {
  id: number | string;
  entryType: SettlementEntryType;
  sheetName: string;
  transactionId: string | null;
  subOrderNo: string | null;
  orderDate: string | null;
  paymentDate: string | null;
  settlementAmount: string;
  saleAmount: string | null;
  returnAmount: string | null;
  commissionAmount: string | null;
  shippingCharge: string | null;
  tcsAmount: string | null;
  tdsAmount: string | null;
  recoveryAmount: string | null;
  compensationAmount: string | null;
  isEstimate: number | boolean;
  supersededByEntryId: number | string | null;
  createdAt: Date | string;
  orderId: number | string | null;
  matchMethod: SettlementMatchMethod | null;
  matchedAt: Date | string | null;
  autoMatchBlocked: number | boolean;
  orderSubOrderNo: string | null;
  matchedById: number | string | null;
  matchedByDisplayName: string | null;
  matchedByEmail: string | null;
  importJobId: number | string;
  importOriginalFilename: string;
  importCreatedAt: Date | string;
}

const ENTRY_SELECT = `SELECT se.id, se.entry_type AS entryType, se.sheet_name AS sheetName,
              se.transaction_id AS transactionId, se.sub_order_no AS subOrderNo,
              se.order_date AS orderDate, se.payment_date AS paymentDate,
              se.settlement_amount AS settlementAmount, se.sale_amount AS saleAmount,
              se.return_amount AS returnAmount, se.commission_amount AS commissionAmount,
              se.shipping_charge AS shippingCharge, se.tcs_amount AS tcsAmount, se.tds_amount AS tdsAmount,
              se.recovery_amount AS recoveryAmount, se.compensation_amount AS compensationAmount,
              se.is_estimate AS isEstimate, se.superseded_by_entry_id AS supersededByEntryId,
              se.created_at AS createdAt, se.order_id AS orderId, se.match_method AS matchMethod,
              se.matched_at AS matchedAt, se.auto_match_blocked AS autoMatchBlocked,
              o.sub_order_no AS orderSubOrderNo,
              mu.id AS matchedById, mu.display_name AS matchedByDisplayName, mu.email AS matchedByEmail,
              ij.id AS importJobId, ij.original_filename AS importOriginalFilename,
              ij.created_at AS importCreatedAt
       FROM settlement_entries se
       JOIN import_jobs ij ON ij.seller_account_id = se.seller_account_id AND ij.id = se.import_job_id
       LEFT JOIN orders o ON o.seller_account_id = se.seller_account_id AND o.id = se.order_id
       LEFT JOIN users mu ON mu.id = se.matched_by_user_id`;

const SORT_COLUMNS: Readonly<Record<SettlementSortKey, string>> = {
  paymentDate: 'se.payment_date',
  settlementAmount: 'se.settlement_amount',
  orderDate: 'se.order_date',
  createdAt: 'se.created_at',
};

/** ORDER BY for a validated sort value; ties break on id in the same direction (stable pages). */
export function entryOrderBy(sort: SettlementSort): string {
  const { key, descending } = parseSort<SettlementSortKey>(sort);
  const dir = descending ? 'DESC' : 'ASC';
  return `${SORT_COLUMNS[key]} ${dir}, se.id ${dir}`;
}

/** Entries of exactly this account (both ids come from requireAccount). */
export function entryScope(scope: AccountScope): SqlFilter {
  return {
    conditions: [
      'se.seller_account_id = :sellerAccountId',
      'se.workspace_id = :workspaceId',
    ],
    replacements: {
      sellerAccountId: scope.sellerAccountId,
      workspaceId: scope.workspaceId,
    },
  };
}

/** SQL condition for a match state; the same precedence as matchState(). */
export const MATCH_STATE_SQL: Readonly<Record<SettlementMatchState, string>> = {
  matched: 'se.order_id IS NOT NULL',
  unmatched: 'se.order_id IS NULL AND se.sub_order_no IS NOT NULL',
  account_level: 'se.order_id IS NULL AND se.sub_order_no IS NULL',
};

export const NOT_SUPERSEDED_SQL = 'se.superseded_by_entry_id IS NULL';

export function matchState(
  orderId: unknown,
  subOrderNo: string | null,
): SettlementMatchState {
  if (orderId !== null && orderId !== undefined) return 'matched';
  return subOrderNo !== null ? 'unmatched' : 'account_level';
}

export function toSettlementEntryDto(
  row: SettlementEntryRow,
): SettlementEntryDto {
  const settlementAmount = moneyOrNull(row.settlementAmount);
  if (settlementAmount === null) {
    throw new Error('settlement_amount is NOT NULL');
  }
  return {
    id: String(row.id),
    entryType: row.entryType,
    sheetName: row.sheetName,
    transactionId: row.transactionId,
    subOrderNo: row.subOrderNo,
    orderDate: row.orderDate,
    paymentDate: row.paymentDate,
    settlementAmount,
    saleAmount: moneyOrNull(row.saleAmount),
    returnAmount: moneyOrNull(row.returnAmount),
    commissionAmount: moneyOrNull(row.commissionAmount),
    shippingCharge: moneyOrNull(row.shippingCharge),
    tcsAmount: moneyOrNull(row.tcsAmount),
    tdsAmount: moneyOrNull(row.tdsAmount),
    recoveryAmount: moneyOrNull(row.recoveryAmount),
    compensationAmount: moneyOrNull(row.compensationAmount),
    isEstimate: toBool(row.isEstimate),
    supersededByEntryId: idOrNull(row.supersededByEntryId),
    importJob: toImportRef(
      row.importJobId,
      row.importOriginalFilename,
      row.importCreatedAt,
    ),
    createdAt: isoTimestamp(row.createdAt),
    match: {
      state: matchState(row.orderId, row.subOrderNo),
      method: row.matchMethod,
      orderId: idOrNull(row.orderId),
      orderSubOrderNo: row.orderSubOrderNo,
      matchedAt: isoTimestampOrNull(row.matchedAt),
      matchedBy: toUserRef(
        row.matchedById,
        row.matchedByDisplayName,
        row.matchedByEmail,
      ),
      autoMatchBlocked: toBool(row.autoMatchBlocked),
    },
  };
}

export interface EntryQueryOptions {
  orderBy: string;
  limit?: number;
  offset?: number;
  transaction?: Transaction;
}

export async function selectEntries(
  sequelize: Sequelize,
  filter: SqlFilter,
  options: EntryQueryOptions,
): Promise<SettlementEntryDto[]> {
  const paged = options.limit !== undefined;
  const rows = await sequelize.query<SettlementEntryRow>(
    `${ENTRY_SELECT}
       ${whereClause(filter)}
       ORDER BY ${options.orderBy}${paged ? '\n       LIMIT :limit OFFSET :offset' : ''}`,
    {
      type: QueryTypes.SELECT,
      replacements: paged
        ? {
            ...filter.replacements,
            limit: options.limit,
            offset: options.offset ?? 0,
          }
        : filter.replacements,
      transaction: options.transaction,
    },
  );
  return rows.map(toSettlementEntryDto);
}

export async function countEntries(
  sequelize: Sequelize,
  filter: SqlFilter,
  transaction?: Transaction,
): Promise<number> {
  const [row] = await sequelize.query<{ total: unknown }>(
    `SELECT COUNT(*) AS total FROM settlement_entries se
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  return toCount(row?.total);
}

/**
 * Row count of the filter plus the "as reported" total: SUM(settlement_amount) over exactly the filtered
 * rows that are not superseded, summed by MySQL in DECIMAL and returned as text (never a JS float).
 */
export async function countAndSumEntries(
  sequelize: Sequelize,
  filter: SqlFilter,
  transaction?: Transaction,
): Promise<{
  total: number;
  summedCount: number;
  summedAmount: string | null;
}> {
  const [row] = await sequelize.query<{
    total: unknown;
    summedCount: unknown;
    summedAmount: unknown;
  }>(
    `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN ${NOT_SUPERSEDED_SQL} THEN 1 END) AS summedCount,
            CAST(SUM(CASE WHEN ${NOT_SUPERSEDED_SQL} THEN se.settlement_amount END) AS CHAR) AS summedAmount
       FROM settlement_entries se
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  return {
    total: toCount(row?.total),
    summedCount: toCount(row?.summedCount),
    summedAmount: moneyOrNull(row?.summedAmount),
  };
}

/** One entry of the account (any match state), or null when it is not in this account. */
export async function findEntry(
  sequelize: Sequelize,
  scope: AccountScope,
  entryId: number | string,
  transaction?: Transaction,
): Promise<SettlementEntryDto | null> {
  const filter = entryScope(scope);
  filter.conditions.push('se.id = CAST(:entryId AS UNSIGNED)');
  filter.replacements.entryId = String(entryId);
  const [entry] = await selectEntries(sequelize, filter, {
    orderBy: 'se.id ASC',
    transaction,
  });
  return entry ?? null;
}
