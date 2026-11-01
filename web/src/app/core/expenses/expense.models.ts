import { PageQuery, PagedResponse } from '../api/paged-response';
import { UserRef } from '../api/refs';

/** `account`: belongs to one seller account. `workspace`: workspace-wide. Never changes later. */
export type ExpenseScope = 'workspace' | 'account';

/**
 * One allowed expense category (`GET /expenses/categories`). The list leaves out everything the
 * settlement workbook already deducts and product purchase cost, so nothing is counted twice.
 */
export interface ExpenseCategory {
  key: string;
  label: string;
  help: string;
  descriptionRequired: boolean;
}

/** One expense. `amount` is a decimal string in INR, always > 0; dates `YYYY-MM-DD`. */
export interface Expense {
  id: string;
  workspaceId: string;
  sellerAccountId: string | null;
  scope: ExpenseScope;
  expenseDate: string;
  category: string;
  categoryLabel: string;
  description: string | null;
  amount: string;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** SUM and COUNT of every expense the filters select (not just the page). `amount` null = none. */
export interface ExpenseTotals {
  amount: string | null;
  count: number;
}

export interface ExpenseListResponse extends PagedResponse<Expense> {
  totals: ExpenseTotals;
}

/** `-` prefix = descending. The API's default is `-expenseDate`. */
export type ExpenseSort =
  | 'expenseDate'
  | '-expenseDate'
  | 'amount'
  | '-amount'
  | 'category'
  | '-category'
  | 'createdAt'
  | '-createdAt';

export const EXPENSE_SORTS: readonly ExpenseSort[] = [
  'expenseDate',
  '-expenseDate',
  'amount',
  '-amount',
  'category',
  '-category',
  'createdAt',
  '-createdAt',
];

export const DEFAULT_EXPENSE_SORT: ExpenseSort = '-expenseDate';

/** Query of the account and workspace expense lists. Only the given values are sent. */
export interface ExpenseListQuery extends PageQuery {
  sort?: ExpenseSort;
  /** Expense date from, `YYYY-MM-DD` (inclusive). */
  from?: string;
  to?: string;
  /** Category keys; sent as a repeated `category` parameter. */
  category?: readonly string[];
}

/** `workspace`: workspace-wide expenses only (the API's default). `all`: plus every account's. */
export type WorkspaceExpenseScope = 'workspace' | 'all';

export interface WorkspaceExpenseListQuery extends ExpenseListQuery {
  scope?: WorkspaceExpenseScope;
}

/** Body of `POST /accounts/:accountId/expenses` and `POST /workspaces/:workspaceId/expenses`. */
export interface CreateExpenseRequest {
  expenseDate: string;
  category: string;
  description?: string;
  /** Decimal string: > 0, at most 2 decimals. */
  amount: string;
}

/** Body of `PATCH /expenses/:expenseId`: only the fields that change; `description: null` clears it. */
export interface UpdateExpenseRequest {
  expenseDate?: string;
  category?: string;
  description?: string | null;
  amount?: string;
}

/** Field rules shared with the API. */
export const EXPENSE_DESCRIPTION_MAX_LENGTH = 255;
/** Digits with up to 2 decimals, no sign, no leading zeros (as the API). */
export const EXPENSE_AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
/** Amounts must be below this. */
export const EXPENSE_AMOUNT_LIMIT = 10_000_000_000;

export const EXPENSE_PAGE_SIZE = 25;

/** Shown wherever expenses are listed or entered, so costs are not counted twice. */
export const DOUBLE_COUNTING_NOTE =
  'Meesho commission, shipping, ads, TCS/TDS and recoveries come from your settlement workbook, and product purchase cost is entered per unit on Products — don’t enter them here, or they are counted twice.';
