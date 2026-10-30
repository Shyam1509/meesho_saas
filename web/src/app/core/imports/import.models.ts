/** The report formats the API can import (see the API's Meesho header profiles). */
export type ImportReportType = 'orders_csv' | 'settlement_xlsx';

/**
 * Lifecycle: upload → `previewed`; confirm → `importing` → `completed` / `failed`; retry
 * (`failed` only) → `importing`; cancel (`previewed` / `failed`) → `cancelled`.
 */
export type ImportStatus = 'previewed' | 'importing' | 'completed' | 'failed' | 'cancelled';

export type ImportRowStatus = 'valid' | 'error' | 'skipped' | 'imported';

export type ImportRowAction = 'insert' | 'update' | 'unchanged' | 'status_event' | 'history_only';

/** What the caller may do with an import now; the server decides (see `allowedActions`). */
export type ImportAction = 'confirm' | 'retry' | 'cancel';

/** `GET /imports/config`: the server's upload limits. */
export interface ImportConfig {
  maxFileMb: number;
  maxRows: number;
}

/** Who uploaded a file. */
export interface ImportUploader {
  id: string;
  displayName: string | null;
  email: string;
}

/**
 * One row of `GET /accounts/:accountId/imports`. Counts are `null` while not known yet (never
 * read a `null` as 0). Dates are ISO-8601 strings; the report period may be a plain `YYYY-MM-DD`.
 */
export interface ImportSummary {
  id: string;
  sellerAccountId: string;
  reportType: ImportReportType;
  status: ImportStatus;
  originalFilename: string;
  fileSizeBytes: number | null;
  totalRows: number | null;
  validRows: number | null;
  errorRows: number | null;
  insertedCount: number | null;
  updatedCount: number | null;
  unchangedCount: number | null;
  /** Rows older than the saved status: kept as status history only, not counted as unchanged. */
  historyOnlyCount: number | null;
  reportPeriodStart: string | null;
  reportPeriodEnd: string | null;
  /** When the report's statuses were current: the user's "Statuses as of", else upload time. */
  dataAsOf: string | null;
  createdAt: string;
  createdBy: ImportUploader | null;
  confirmedAt: string | null;
  completedAt: string | null;
  failureMessage: string | null;
  /**
   * The actions the server allows now (`previewed` → confirm, cancel; `failed` and a stale
   * `importing` → retry, cancel). The UI shows buttons from this list only.
   */
  allowedActions: ImportAction[];
}

/** One sheet of the file (a CSV has one), with how its columns were matched. */
export interface ImportSheetPreview {
  name: string;
  /** The ledger entry type the sheet maps to; `null` for an ignored sheet or a CSV. */
  entryType: string | null;
  ignored: boolean;
  rows: number | null;
  validRows: number | null;
  errorRows: number | null;
  recognisedColumns: string[];
  missingOptionalColumns: string[];
  ignoredColumns: string[];
}

/** What a confirm would do, counted at upload. */
export interface ImportPlannedCounts {
  insert: number | null;
  update: number | null;
  unchanged: number | null;
  /** Rows older than the saved status: only added to the status history. */
  historyOnly: number | null;
  statusEvents: number | null;
}

export interface ImportPreview {
  sheets: ImportSheetPreview[];
  planned: ImportPlannedCounts;
  /** The first valid rows (up to 10). */
  sampleRows: ImportRow[];
}

/** `GET /imports/:importId` and the result of every import action. */
export interface ImportDetail extends ImportSummary {
  /** `null` only if the API stored no preview for this job. */
  preview: ImportPreview | null;
}

export interface ImportRowError {
  field: string;
  reason: string;
}

/** One parsed row. `values` holds the mapped fields only, normalised; `null` = empty cell. */
export interface ImportRow {
  id: string;
  sheetName: string | null;
  rowNumber: number;
  status: ImportRowStatus;
  action: ImportRowAction | null;
  errors: ImportRowError[];
  values: Record<string, string | null>;
}

/** `{ items, page, pageSize, total }`, the API's paginated list shape. */
export interface PagedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface ImportRowsQuery extends PageQuery {
  status?: ImportRowStatus;
}

/** Body of `POST /imports/:importId/confirm`. `skipErrorRows` must be true when rows have errors. */
export interface ConfirmImportRequest {
  skipErrorRows?: boolean;
}

/** Files the API accepts, by extension (the API also checks the content). */
export const IMPORT_FILE_EXTENSIONS: readonly string[] = ['.csv', '.xlsx'];
/**
 * The API's default `IMPORT_MAX_FILE_MB`, used only until (or if) `GET /imports/config` answers;
 * the server enforces its own limit (413) either way.
 */
export const IMPORT_MAX_FILE_MB = 10;
/** Default page size of the import lists. */
export const IMPORT_PAGE_SIZE = 20;

const REPORT_TYPE_LABELS: Record<ImportReportType, string> = {
  orders_csv: 'Orders (CSV)',
  settlement_xlsx: 'Settlement (XLSX)',
};

const STATUS_LABELS: Record<ImportStatus, string> = {
  previewed: 'Previewed',
  importing: 'Importing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const ACTION_LABELS: Record<ImportRowAction, string> = {
  insert: 'Insert',
  update: 'Update',
  unchanged: 'Unchanged',
  status_event: 'Status event',
  history_only: 'History only',
};

/** Labels for the mapped fields of the API's header profiles; others are humanised. */
const FIELD_LABELS: Record<string, string> = {
  subOrderNo: 'Sub order no.',
  orderNo: 'Order no.',
  status: 'Status',
  orderDate: 'Order date',
  quantity: 'Quantity',
  catalogId: 'Catalog ID',
  customerState: 'Customer state',
  productName: 'Product name',
  sku: 'SKU',
  size: 'Size',
  supplierListedPrice: 'Supplier listed price',
  supplierDiscountedPrice: 'Supplier discounted price',
  packetId: 'Packet ID',
  transactionId: 'Transaction ID',
  paymentDate: 'Payment date',
  settlementAmount: 'Settlement amount',
  saleAmount: 'Sale amount',
  returnAmount: 'Return amount',
  commissionAmount: 'Commission',
  shippingCharge: 'Shipping charge',
  tcsAmount: 'TCS',
  tdsAmount: 'TDS',
  recoveryAmount: 'Recovery',
  compensationAmount: 'Compensation',
  entryType: 'Entry type',
};

export function reportTypeLabel(type: string): string {
  return REPORT_TYPE_LABELS[type as ImportReportType] ?? humanise(type);
}

export function importStatusLabel(status: string): string {
  return STATUS_LABELS[status as ImportStatus] ?? humanise(status);
}

export function rowActionLabel(action: string | null): string | null {
  return action === null ? null : (ACTION_LABELS[action as ImportRowAction] ?? humanise(action));
}

/**
 * A known label for a profile field (`subOrderNo` → "Sub order no."), a humanised camelCase key
 * (`fooBar` → "Foo bar"), or the name exactly as given (a column or sheet name from the file).
 */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? (/^[a-z][a-zA-Z0-9]*$/.test(field) ? humanise(field) : field);
}

/** `order_payment` → "Order payment". */
export function entryTypeLabel(entryType: string): string {
  return humanise(entryType);
}

/** Money fields are formatted as INR; the API sends them as decimal strings. */
export function isMoneyField(field: string): boolean {
  return /(Amount|Price|Charge)$/.test(field);
}

/** Date fields arrive as `YYYY-MM-DD`. */
export function isDateField(field: string): boolean {
  return /Date$/.test(field);
}

/** `orderDate` → "Order date"; `order_payment` → "Order payment"; anything else unchanged. */
function humanise(value: string): string {
  const words = value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.length > 0 ? words[0].toUpperCase() + words.slice(1) : value;
}
