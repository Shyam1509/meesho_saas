import { Op, type Transaction } from 'sequelize';
import type { ImportReportType, ImportRowAction } from '../../database/models';
import { Order, SettlementEntry } from '../../database/models';
import type { RowValues } from '../parsing/parsed-report';
import {
  ORDER_VALUE_FIELDS,
  planOrder,
  type ExistingOrder,
} from './order-plan';

/** Rows per IN (...) lookup / bulk statement. */
export const BATCH_SIZE = 500;

export function chunk<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Existing orders of the account for these sub-order numbers (exact, binary-collated match). */
export async function findExistingOrders(
  sellerAccountId: number,
  subOrderNos: readonly string[],
  transaction?: Transaction,
): Promise<Map<string, ExistingOrder>> {
  const found = new Map<string, ExistingOrder>();
  if (subOrderNos.length === 0) return found;
  const orders = await Order.findAll({
    where: { sellerAccountId, subOrderNo: { [Op.in]: [...subOrderNos] } },
    transaction,
  });
  for (const order of orders) {
    const values = {} as ExistingOrder['values'];
    for (const field of ORDER_VALUE_FIELDS) {
      const value = order[field];
      values[field] = value === null ? null : String(value);
    }
    found.set(order.subOrderNo, {
      id: order.id,
      firstImportJobId: order.firstImportJobId,
      currentStatus: order.currentStatus,
      currentStatusObservedAt: order.currentStatusObservedAt,
      values,
    });
  }
  return found;
}

/** Which of these fingerprints the account already has. */
export async function findExistingFingerprints(
  sellerAccountId: number,
  fingerprints: readonly string[],
  transaction?: Transaction,
): Promise<Set<string>> {
  if (fingerprints.length === 0) return new Set();
  const entries = await SettlementEntry.findAll({
    attributes: ['entryFingerprint'],
    where: {
      sellerAccountId,
      entryFingerprint: { [Op.in]: [...fingerprints] },
    },
    transaction,
  });
  return new Set(entries.map((e) => e.entryFingerprint));
}

export interface PlannedCounts {
  insert: number;
  update: number;
  unchanged: number;
  historyOnly: number;
  statusEvents: number;
}

/** A valid staged row as the planner sees it. */
export interface PlannableRow {
  values: RowValues;
  rowHash: string | null;
}

/**
 * Planned action of every valid row against the data now in the database (read-only). Orders: per
 * planOrder, plus one status event per row. Settlements: a fingerprint the account already has →
 * unchanged, else insert.
 */
export async function planRows(
  reportType: ImportReportType,
  sellerAccountId: number,
  rows: readonly PlannableRow[],
  dataAsOf: Date,
  transaction?: Transaction,
): Promise<ImportRowAction[]> {
  const actions: ImportRowAction[] = [];
  for (const batch of chunk(rows)) {
    if (reportType === 'orders_csv') {
      const existing = await findExistingOrders(
        sellerAccountId,
        batch.map((r) => r.values.subOrderNo as string),
        transaction,
      );
      for (const row of batch) {
        actions.push(
          planOrder(
            existing.get(row.values.subOrderNo as string),
            row.values,
            dataAsOf,
          ).action,
        );
      }
    } else {
      const known = await findExistingFingerprints(
        sellerAccountId,
        batch.map((r) => r.rowHash as string),
        transaction,
      );
      for (const row of batch) {
        actions.push(known.has(row.rowHash as string) ? 'unchanged' : 'insert');
      }
    }
  }
  return actions;
}

export function countActions(
  reportType: ImportReportType,
  actions: readonly ImportRowAction[],
): PlannedCounts {
  const counts: PlannedCounts = {
    insert: 0,
    update: 0,
    unchanged: 0,
    historyOnly: 0,
    statusEvents: reportType === 'orders_csv' ? actions.length : 0,
  };
  for (const action of actions) {
    if (action === 'insert') counts.insert += 1;
    else if (action === 'update') counts.update += 1;
    else if (action === 'status_event') counts.historyOnly += 1;
    else counts.unchanged += 1;
  }
  return counts;
}
