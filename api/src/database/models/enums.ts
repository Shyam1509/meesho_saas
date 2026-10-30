/**
 * Allowed values of the enumerated columns. The database enforces the same lists with named CHECK
 * constraints (VARCHAR + CHECK, not native ENUM); test/db/schema.db-spec.ts asserts they match.
 */
export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const WORKSPACE_ROLES = ['owner', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const SELLER_ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type SellerAccountStatus = (typeof SELLER_ACCOUNT_STATUSES)[number];

export const IMPORT_REPORT_TYPES = ['orders_csv', 'settlement_xlsx'] as const;
export type ImportReportType = (typeof IMPORT_REPORT_TYPES)[number];

export const IMPORT_JOB_STATUSES = [
  'pending',
  'previewed',
  'importing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  'valid',
  'error',
  'skipped',
  'imported',
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_ROW_ACTIONS = [
  'insert',
  'update',
  'unchanged',
  'status_event',
] as const;
export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number];

export const PRODUCT_STATUSES = ['active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const SETTLEMENT_ENTRY_TYPES = [
  'order_payment',
  'ads_cost',
  'referral_payment',
  'compensation',
  'recovery',
  'other',
] as const;
export type SettlementEntryType = (typeof SETTLEMENT_ENTRY_TYPES)[number];

export const SETTLEMENT_MATCH_METHODS = ['auto', 'manual'] as const;
export type SettlementMatchMethod = (typeof SETTLEMENT_MATCH_METHODS)[number];

export const EXPENSE_SCOPES = ['workspace', 'account'] as const;
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];

export const RECONCILIATION_TRIGGER_TYPES = ['import', 'manual'] as const;
export type ReconciliationTriggerType =
  (typeof RECONCILIATION_TRIGGER_TYPES)[number];

export const RECONCILIATION_RUN_STATUSES = [
  'running',
  'completed',
  'failed',
] as const;
export type ReconciliationRunStatus =
  (typeof RECONCILIATION_RUN_STATUSES)[number];

/** Currencies of product costs and expenses (orders and settlements carry none: INR as reported). */
export const CURRENCIES = ['INR'] as const;
export type Currency = (typeof CURRENCIES)[number];
