import { WorkspaceExpenseScope } from '../expenses/expense.models';
import { OrderSettlementFilter } from '../orders/order.models';
import { MatchState, SettlementDateBasis } from '../settlements/settlement.models';

/**
 * CSV exports (`GET …/reports/*.csv`): UTF-8 with a BOM, CRLF, a header row; amounts as plain
 * numbers (no ₹, no grouping), an empty cell for a missing value. At most
 * {@link MAX_EXPORT_ROWS} rows: above that the API answers 422 and asks to narrow the filters.
 */

export const MAX_EXPORT_ROWS = 100_000;

/** `GET /accounts/:accountId/reports/orders.csv`: the orders list's filters. */
export interface OrdersCsvQuery {
  status?: readonly string[];
  /** Order date, `YYYY-MM-DD` (inclusive). */
  from?: string;
  to?: string;
  /** Earliest matched settlement entry's payment date, `YYYY-MM-DD` (inclusive). */
  paymentFrom?: string;
  paymentTo?: string;
  q?: string;
  settlement?: OrderSettlementFilter;
}

/** `GET /accounts/:accountId/reports/settlements.csv`: the settlements list's filters. */
export interface SettlementsCsvQuery {
  entryType?: readonly string[];
  from?: string;
  to?: string;
  /** What `from` / `to` filter on; the API's default is the payment date. */
  dateBasis?: SettlementDateBasis;
  q?: string;
  match?: MatchState;
  /** Sent only when true. */
  includeSuperseded?: boolean;
}

/** `GET /accounts/:accountId/reports/expenses.csv`. */
export interface ExpensesCsvQuery {
  /** Expense date, `YYYY-MM-DD` (inclusive). */
  from?: string;
  to?: string;
  category?: readonly string[];
}

/** `GET /workspaces/:workspaceId/reports/expenses.csv`. */
export interface WorkspaceExpensesCsvQuery extends ExpensesCsvQuery {
  /** `workspace`: workspace-wide expenses only; `all`: plus every seller account's. */
  scope?: WorkspaceExpenseScope;
}

/** A downloaded export. */
export interface CsvFile {
  blob: Blob;
  /** From `Content-Disposition`, else a generic name. */
  filename: string;
}

/** What each file holds, in column order, for the Reports page. */
export const ORDER_EXPORT_COLUMNS: readonly string[] = [
  'Sub order no.',
  'Order no.',
  'Order date',
  'Product name',
  'SKU',
  'Size',
  'Quantity',
  'Customer state',
  'Supplier listed price (as reported)',
  'Supplier discounted price (as reported)',
  'Current status',
  'Status observed at',
  'Settled amount (as reported) and matched entry count',
  'Product cost state, unit cost and total',
  'Source import file',
];

export const SETTLEMENT_EXPORT_COLUMNS: readonly string[] = [
  'Entry type',
  'Sheet',
  'Transaction ID',
  'Sub order no.',
  'Order date',
  'Payment date',
  'Settlement amount',
  'Sale, return, commission and shipping amounts',
  'TCS and TDS',
  'Recovery and compensation',
  'Estimate / superseded flags',
  'Match state, method and matched order',
  'Source import file',
];

export const EXPENSE_EXPORT_COLUMNS: readonly string[] = [
  'Expense date',
  'Scope (seller account or workspace-wide)',
  'Seller account',
  'Category',
  'Description',
  'Amount',
  'Created by and when',
];
