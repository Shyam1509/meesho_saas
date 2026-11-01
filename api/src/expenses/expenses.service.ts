import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService, changedFields } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import {
  EXPENSE_NOT_FOUND_MESSAGE,
  WorkspaceAccessService,
} from '../authorization/workspace-access.service';
import { ApiException } from '../common/errors/api.exception';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import { listWindow } from '../common/http/list-query';
import {
  canonicalDecimal,
  EXPENSE_AMOUNT_RULE,
} from '../common/http/value-rules';
import type { SqlFilter } from '../common/sql/account-scope';
import { readSnapshot } from '../common/sql/read-snapshot';
import {
  Expense,
  type ExpenseScope,
  type SellerAccountStatus,
} from '../database/models';
import type {
  CreateExpenseDto,
  ExpenseCategoryListDto,
  ExpenseDto,
  ExpenseListDto,
  ListExpensesQueryDto,
  ListWorkspaceExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import {
  categoryRequiresDescription,
  DESCRIPTION_REQUIRED_REASON,
  EXPENSE_CATEGORIES,
} from './expense-categories';
import {
  accountExpenseScope,
  addExpenseFilters,
  countAndSumExpenses,
  expenseOrderBy,
  findExpense,
  selectExpenses,
  workspaceExpenseScope,
} from './expense-queries';

export const EXPENSE_ACCOUNT_DISABLED_MESSAGE =
  'This seller account is disabled: enable it before changing its expenses.';

interface ExpenseFields {
  expenseDate?: string;
  category?: string;
  description?: string | null;
  amount?: string;
}

/** Where a new expense goes: the whole workspace, or one of its seller accounts. */
interface ExpenseTarget {
  workspaceId: number;
  sellerAccountId: number | null;
  scope: ExpenseScope;
}

function assertAccountActive(
  scope: ExpenseScope,
  accountStatus: SellerAccountStatus | null,
): void {
  if (scope === 'account' && accountStatus !== 'active') {
    throw new ApiException('CONFLICT', EXPENSE_ACCOUNT_DISABLED_MESSAGE);
  }
}

/**
 * Manual expenses (Milestone 6), workspace-wide or per seller account. Members read; only the owner creates,
 * edits and deletes. Workspace routes resolve through requireWorkspace, account routes through
 * requireAccount, /expenses/:id through requireExpense (one query each; not a member → 404). The scope
 * (and the account) of an expense never changes. Expenses of a disabled account are read-only (409).
 * Every change writes its audit row in the same transaction.
 */
@Injectable()
export class ExpensesService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  categories(): ExpenseCategoryListDto {
    return {
      items: EXPENSE_CATEGORIES.map((c) => ({
        key: c.key,
        label: c.label,
        help: c.help,
        descriptionRequired: c.descriptionRequired,
      })),
    };
  }

  async listForAccount(
    userId: number,
    accountId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseListDto> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    return this.page(
      addExpenseFilters(accountExpenseScope(account), query),
      query,
    );
  }

  async listForWorkspace(
    userId: number,
    workspaceId: string,
    query: ListWorkspaceExpensesQueryDto,
  ): Promise<ExpenseListDto> {
    const { workspace } = await this.access.requireWorkspace(
      userId,
      workspaceId,
      'member',
    );
    return this.page(
      addExpenseFilters(
        workspaceExpenseScope(workspace.id, query.scope),
        query,
      ),
      query,
    );
  }

  /** Owner. An expense of one seller account. Audit expense.created. */
  createForAccount(
    actor: Actor,
    accountId: string,
    dto: CreateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.sequelize.transaction(async (transaction) => {
      const { account } = await this.access.requireAccount(
        actor.userId,
        accountId,
        'owner',
        { transaction },
      );
      assertAccountActive('account', account.status);
      return this.insert(
        actor,
        {
          workspaceId: account.workspaceId,
          sellerAccountId: account.id,
          scope: 'account',
        },
        dto,
        transaction,
      );
    });
  }

  /** Owner. A workspace-wide expense (no seller account). Audit expense.created. */
  createForWorkspace(
    actor: Actor,
    workspaceId: string,
    dto: CreateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.sequelize.transaction(async (transaction) => {
      const { workspace } = await this.access.requireWorkspace(
        actor.userId,
        workspaceId,
        'owner',
        { transaction },
      );
      return this.insert(
        actor,
        {
          workspaceId: workspace.id,
          sellerAccountId: null,
          scope: 'workspace',
        },
        dto,
        transaction,
      );
    });
  }

  /**
   * Owner. Date, category, description and / or amount; never the scope. The resulting row must still have
   * a description when its category is "other" (400). No change → 200 without a write. Audit
   * expense.updated (changed fields only).
   */
  update(
    actor: Actor,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.sequelize.transaction(async (transaction) => {
      const expense = await this.lockForChange(actor, expenseId, transaction);
      const fields = changedFields<ExpenseFields>(
        {
          expenseDate: expense.expenseDate,
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
        },
        {
          expenseDate: dto.expenseDate,
          category: dto.category,
          description: dto.description,
          amount:
            dto.amount === undefined
              ? undefined
              : canonicalDecimal(dto.amount, EXPENSE_AMOUNT_RULE),
        },
      );
      const category = fields.after.category ?? expense.category;
      const description = Object.prototype.hasOwnProperty.call(
        fields.after,
        'description',
      )
        ? fields.after.description
        : expense.description;
      if (categoryRequiresDescription(category) && !description) {
        throw new RequestValidationException([
          { field: 'description', reasons: [DESCRIPTION_REQUIRED_REASON] },
        ]);
      }
      if (Object.keys(fields.after).length > 0) {
        await Expense.update(fields.after, {
          where: { id: expense.id },
          transaction,
        });
        await this.audit.record(
          {
            action: 'expense.updated',
            entityType: 'expense',
            entityId: expense.id,
            workspaceId: expense.workspaceId,
            sellerAccountId: expense.sellerAccountId,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            before: fields.before,
            after: fields.after,
          },
          transaction,
        );
      }
      return this.dto(expense.id, transaction);
    });
  }

  /** Owner. Hard delete (expenses are manual entries, not report history). Audit expense.deleted. */
  async remove(actor: Actor, expenseId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const expense = await this.lockForChange(actor, expenseId, transaction);
      const before = {
        scope: expense.scope,
        expenseDate: expense.expenseDate,
        category: expense.category,
        description: expense.description,
        amount: expense.amount,
      };
      await expense.destroy({ transaction });
      await this.audit.record(
        {
          action: 'expense.deleted',
          entityType: 'expense',
          entityId: expense.id,
          workspaceId: expense.workspaceId,
          sellerAccountId: expense.sellerAccountId,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          before,
        },
        transaction,
      );
    });
  }

  private async insert(
    actor: Actor,
    target: ExpenseTarget,
    dto: CreateExpenseDto,
    transaction: Transaction,
  ): Promise<ExpenseDto> {
    const values = {
      expenseDate: dto.expenseDate,
      category: dto.category,
      description: dto.description ?? null,
      amount: canonicalDecimal(dto.amount, EXPENSE_AMOUNT_RULE),
    };
    const expense = await Expense.create(
      { ...target, ...values, createdByUserId: actor.userId },
      { transaction },
    );
    await this.audit.record(
      {
        action: 'expense.created',
        entityType: 'expense',
        entityId: expense.id,
        workspaceId: target.workspaceId,
        sellerAccountId: target.sellerAccountId,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        after: { scope: target.scope, ...values },
      },
      transaction,
    );
    return this.dto(expense.id, transaction);
  }

  /** Resolve for an owner (404 / 403), refuse a disabled account's expense (409), lock the row. */
  private async lockForChange(
    actor: Actor,
    expenseId: string,
    transaction: Transaction,
  ): Promise<Expense> {
    const { expense: resolved, accountStatus } =
      await this.access.requireExpense(actor.userId, expenseId, 'owner', {
        transaction,
      });
    assertAccountActive(resolved.scope, accountStatus);
    const expense = await Expense.findOne({
      where: { id: resolved.id, workspaceId: resolved.workspaceId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!expense) throw new NotFoundException(EXPENSE_NOT_FOUND_MESSAGE);
    return expense;
  }

  private async dto(
    expenseId: number,
    transaction: Transaction,
  ): Promise<ExpenseDto> {
    const dto = await findExpense(this.sequelize, expenseId, transaction);
    if (!dto) throw new Error(`expense ${expenseId} vanished`);
    return dto;
  }

  /** A page, its total and its DECIMAL sum, all from ONE read-only snapshot (they always agree). */
  private async page(
    filter: SqlFilter,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseListDto> {
    const { limit, offset } = listWindow(query);
    const [items, counts] = await readSnapshot(
      this.sequelize,
      async (transaction) =>
        [
          await selectExpenses(this.sequelize, filter, {
            orderBy: expenseOrderBy(query.sort),
            limit,
            offset,
            transaction,
          }),
          await countAndSumExpenses(this.sequelize, filter, transaction),
        ] as const,
    );
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: counts.total,
      totals: { amount: counts.amount, count: counts.total },
    };
  }
}
