import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { parseSort } from '../common/http/list-query';
import { isoTimestamp } from '../common/http/refs.dto';
import { whereClause, type SqlFilter } from '../common/sql/account-scope';
import { idOrNull, moneyOrNull, toCount } from '../common/sql/values';
import type { ExpenseScope } from '../database/models';
import type {
  ExpenseDto,
  ExpenseSort,
  ExpenseSortKey,
  ListExpensesQueryDto,
} from './dto/expense.dto';
import { categoryLabel, EXPENSE_CATEGORIES } from './expense-categories';

export interface ExpenseRow {
  id: number | string;
  workspaceId: number | string;
  sellerAccountId: number | string | null;
  scope: ExpenseScope;
  expenseDate: string;
  category: string;
  description: string | null;
  amount: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  createdById: number | string;
  createdByDisplayName: string | null;
  createdByEmail: string;
}

const EXPENSE_SELECT = `SELECT e.id, e.workspace_id AS workspaceId, e.seller_account_id AS sellerAccountId,
              e.scope, e.expense_date AS expenseDate, e.category, e.description, e.amount,
              e.created_at AS createdAt, e.updated_at AS updatedAt,
              u.id AS createdById, u.display_name AS createdByDisplayName, u.email AS createdByEmail
       FROM expenses e
       JOIN users u ON u.id = e.created_by_user_id`;

/**
 * `sort=category` follows the LABEL people see, not the key: FIELD() gives each key its position in the
 * allowlist sorted by label (case-insensitive). The keys are our own constants ([a-z_] only, asserted), so
 * they are written into the SQL; a stored key outside the list (none can be written) sorts first.
 */
export const CATEGORY_LABEL_ORDER_SQL = `FIELD(e.category, ${[
  ...EXPENSE_CATEGORIES,
]
  .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
  .map(({ key }) => {
    if (!/^[a-z_]+$/.test(key)) throw new Error(`unsafe category key ${key}`);
    return `'${key}'`;
  })
  .join(', ')})`;

const SORT_COLUMNS: Readonly<Record<ExpenseSortKey, string>> = {
  expenseDate: 'e.expense_date',
  amount: 'e.amount',
  category: CATEGORY_LABEL_ORDER_SQL,
  createdAt: 'e.created_at',
};

/** ORDER BY for a validated sort value; ties break on id in the same direction (stable pages). */
export function expenseOrderBy(sort: ExpenseSort): string {
  const { key, descending } = parseSort<ExpenseSortKey>(sort);
  const dir = descending ? 'DESC' : 'ASC';
  return `${SORT_COLUMNS[key]} ${dir}, e.id ${dir}`;
}

/** Expenses of exactly this seller account (ids from requireAccount). */
export function accountExpenseScope(account: {
  id: number;
  workspaceId: number;
}): SqlFilter {
  return {
    conditions: [
      'e.workspace_id = :workspaceId',
      'e.seller_account_id = :sellerAccountId',
    ],
    replacements: {
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
    },
  };
}

/** Expenses of a workspace (id from requireWorkspace): workspace-wide only, or all of them. */
export function workspaceExpenseScope(
  workspaceId: number,
  scope: 'workspace' | 'all',
): SqlFilter {
  const conditions = ['e.workspace_id = :workspaceId'];
  if (scope === 'workspace') conditions.push('e.seller_account_id IS NULL');
  return { conditions, replacements: { workspaceId } };
}

/** The shared date / category filters (values bound). */
export function addExpenseFilters(
  filter: SqlFilter,
  query: Pick<ListExpensesQueryDto, 'from' | 'to' | 'category'>,
): SqlFilter {
  if (query.from) {
    filter.conditions.push('e.expense_date >= :from');
    filter.replacements.from = query.from;
  }
  if (query.to) {
    filter.conditions.push('e.expense_date <= :to');
    filter.replacements.to = query.to;
  }
  if (query.category && query.category.length > 0) {
    filter.conditions.push('e.category IN (:categories)');
    filter.replacements.categories = [...new Set(query.category)];
  }
  return filter;
}

export function toExpenseDto(row: ExpenseRow): ExpenseDto {
  const amount = moneyOrNull(row.amount);
  if (amount === null) throw new Error('expenses.amount is NOT NULL');
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    sellerAccountId: idOrNull(row.sellerAccountId),
    scope: row.scope,
    expenseDate: row.expenseDate,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    description: row.description,
    amount,
    createdBy: {
      id: String(row.createdById),
      displayName: row.createdByDisplayName,
      email: row.createdByEmail,
    },
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

export async function selectExpenses(
  sequelize: Sequelize,
  filter: SqlFilter,
  options: {
    orderBy: string;
    limit?: number;
    offset?: number;
    transaction?: Transaction;
  },
): Promise<ExpenseDto[]> {
  const paged = options.limit !== undefined;
  const rows = await sequelize.query<ExpenseRow>(
    `${EXPENSE_SELECT}
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
  return rows.map(toExpenseDto);
}

/** Row count of the filter and SUM(amount) over exactly those rows, summed by MySQL in DECIMAL (as text). */
export async function countAndSumExpenses(
  sequelize: Sequelize,
  filter: SqlFilter,
  transaction?: Transaction,
): Promise<{ total: number; amount: string | null }> {
  const [row] = await sequelize.query<{ total: unknown; amount: unknown }>(
    `SELECT COUNT(*) AS total, CAST(SUM(e.amount) AS CHAR) AS amount
       FROM expenses e
       ${whereClause(filter)}`,
    { type: QueryTypes.SELECT, replacements: filter.replacements, transaction },
  );
  return { total: toCount(row?.total), amount: moneyOrNull(row?.amount) };
}

/** One expense by id (already resolved for the caller), or null. */
export async function findExpense(
  sequelize: Sequelize,
  expenseId: number | string,
  transaction?: Transaction,
): Promise<ExpenseDto | null> {
  const [expense] = await selectExpenses(
    sequelize,
    {
      conditions: ['e.id = CAST(:expenseId AS UNSIGNED)'],
      replacements: { expenseId: String(expenseId) },
    },
    { orderBy: 'e.id ASC', transaction },
  );
  return expense ?? null;
}
