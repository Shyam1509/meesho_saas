import type { ImportRowAction } from '../../database/models';
import type { RowValues } from '../parsing/parsed-report';

/** Order columns an orders CSV can set, besides the status. */
export const ORDER_VALUE_FIELDS = [
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
] as const;
export type OrderValueField = (typeof ORDER_VALUE_FIELDS)[number];

/** The order values an import compares and writes (all as strings; quantity too). */
export type OrderValues = Record<OrderValueField, string | null> & {
  currentStatus: string;
};

/** The parts of an existing orders row the plan needs (DECIMAL/DATEONLY come back as strings). */
export interface ExistingOrder {
  id: number;
  firstImportJobId: number;
  currentStatus: string;
  currentStatusObservedAt: Date;
  values: Record<OrderValueField, string | null>;
}

export interface OrderPlan {
  /**
   * insert: new order. update: the report is not older than the order's current observation and
   * something changes. unchanged: not older, nothing changes (the observation time still moves forward).
   * status_event: the report is older: history only, the order is left as it is.
   * Every plan also records one status event (one per order per import).
   */
  action: ImportRowAction;
  /** Final order values for insert / update / unchanged; null for status_event. */
  values: OrderValues | null;
}

/** Order values from a valid CSV row. Absent or blank optional cells are null. */
export function rowOrderValues(row: RowValues): OrderValues {
  const values = {} as OrderValues;
  for (const field of ORDER_VALUE_FIELDS) values[field] = row[field] ?? null;
  values.currentStatus = row.status as string;
  return values;
}

/**
 * What importing one valid orders row does, given the existing order (if any) and the report's
 * observation time (import_jobs.data_as_of):
 * - no order → insert;
 * - order observed later than this report → status_event (current values untouched);
 * - otherwise the report's values win, except that a blank or absent cell never erases a value an
 *   earlier report gave (blank = "not reported"); update when anything differs, else unchanged.
 * Equal observation times count as "not older" (forward).
 */
export function planOrder(
  existing: ExistingOrder | undefined,
  row: RowValues,
  dataAsOf: Date,
): OrderPlan {
  const incoming = rowOrderValues(row);
  if (!existing) return { action: 'insert', values: incoming };
  if (existing.currentStatusObservedAt.getTime() > dataAsOf.getTime()) {
    return { action: 'status_event', values: null };
  }
  const merged = { ...existing.values } as OrderValues;
  let changed = existing.currentStatus !== incoming.currentStatus;
  merged.currentStatus = incoming.currentStatus;
  for (const field of ORDER_VALUE_FIELDS) {
    const value = incoming[field];
    if (value === null) continue;
    if (merged[field] !== value) changed = true;
    merged[field] = value;
  }
  return { action: changed ? 'update' : 'unchanged', values: merged };
}
