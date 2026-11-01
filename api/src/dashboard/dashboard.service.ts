import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { readSnapshot } from '../common/sql/read-snapshot';
import {
  CONTRIBUTION_FORMULA,
  estimatedContribution,
  isComplete,
} from './contribution';
import {
  flagsOf,
  summarizeEntries,
  summarizeExpenses,
  summarizeOrders,
  trendFromGroups,
} from './dashboard-aggregate';
import {
  entryGroups,
  expenseGroups,
  orderGroups,
  undatedEntries,
  workspaceAccounts,
  type AccountRow,
  type EntryGroup,
  type ExpenseGroup,
  type MetricScope,
  type OrderGroup,
} from './dashboard-queries';
import {
  bucketStarts,
  resolveDashboardFilters,
  type ResolvedDashboardFilters,
} from './dashboard-range';
import type {
  DashboardAccountRowDto,
  DashboardDto,
  DashboardQueryDto,
} from './dto/dashboard.dto';

/** The grouped rows of one dashboard read (one scan per table). */
interface Groups {
  orders: OrderGroup[];
  entries: EntryGroup[];
  expenses: ExpenseGroup[];
}

/**
 * The Milestone 7 dashboards (members). Every number follows the metric definitions in api/README.md
 * ("Dashboard and reports"), is read in ONE read-only snapshot (so the numbers agree with each other) and
 * is selected through the same SQL fragments as the matching list, so each links to a list with the same
 * total. Each table is read once, grouped by seller account; the account rows and the totals are exact sums
 * of the same groups. Never profit: "estimated contribution", flagged incomplete when anything is missing.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
  ) {}

  async forAccount(
    userId: number,
    accountId: string,
    query: DashboardQueryDto,
  ): Promise<DashboardDto> {
    const filters = resolveDashboardFilters(query);
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    const scope: MetricScope = {
      kind: 'account',
      workspaceId: account.workspaceId,
      sellerAccountId: account.id,
    };
    return readSnapshot(this.sequelize, async (transaction) => {
      const { body } = await this.read(scope, filters, transaction);
      return {
        scope: {
          kind: 'account' as const,
          id: String(account.id),
          name: account.displayName,
        },
        ...body,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  async forWorkspace(
    userId: number,
    workspaceId: string,
    query: DashboardQueryDto,
  ): Promise<DashboardDto> {
    const filters = resolveDashboardFilters(query);
    const { workspace } = await this.access.requireWorkspace(
      userId,
      workspaceId,
      'member',
    );
    const scope: MetricScope = { kind: 'workspace', workspaceId: workspace.id };
    return readSnapshot(this.sequelize, async (transaction) => {
      const { body, groups } = await this.read(scope, filters, transaction);
      const accounts = await workspaceAccounts(
        this.sequelize,
        workspace.id,
        transaction,
      );
      return {
        scope: {
          kind: 'workspace' as const,
          id: String(workspace.id),
          name: workspace.name,
        },
        ...body,
        accounts: accounts.map((a) => accountRow(a, groups)),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Metrics 1–7 for the scope: 4 queries (orders + costs, entries, expenses — each grouped by account and
   * trend bucket — and the undated count), all in the caller's snapshot transaction.
   */
  private async read(
    scope: MetricScope,
    filters: ResolvedDashboardFilters,
    transaction: Transaction,
  ): Promise<{
    body: Omit<DashboardDto, 'scope' | 'accounts' | 'generatedAt'>;
    groups: Groups;
  }> {
    const seq = this.sequelize;
    const groups: Groups = {
      orders: await orderGroups(seq, scope, filters, transaction),
      entries: await entryGroups(seq, scope, filters, transaction),
      expenses: await expenseGroups(seq, scope, filters, transaction),
    };
    const undated = await undatedEntries(seq, scope, filters, transaction);
    const trend = trendFromGroups(
      bucketStarts(filters.from, filters.to, filters.granularity),
      groups,
    );
    const orders = summarizeOrders(groups.orders);
    const entries = summarizeEntries(groups.entries);
    const expenses = summarizeExpenses(groups.expenses);
    const flags = flagsOf(orders, entries);
    return {
      groups,
      body: {
        filters: { ...filters, statuses: [...filters.statuses] },
        orders: {
          count: orders.count,
          units: orders.units,
          statusCounts: orders.statusCounts,
          orderValueDiscounted: orders.orderValueDiscounted,
          orderValueListed: orders.orderValueListed,
          pricesMissing: orders.pricesMissing,
        },
        settlements: {
          amount: entries.amount,
          count: entries.count,
          undatedEntries: undated,
          byType: entries.byType,
          components: entries.components,
        },
        productCost: {
          known: orders.known,
          knownExact: orders.knownExact,
          ordersKnown: orders.ordersKnown,
          ordersCostUnknown: orders.ordersCostUnknown,
          ordersNoProduct: orders.ordersNoProduct,
          cancelledOrReturnedOrders: orders.cancelledOrReturnedOrders,
          cancelledOrReturnedCost: orders.cancelledOrReturnedCost,
        },
        expenses: {
          amount: expenses.amount,
          count: expenses.count,
          accountAmount: expenses.accountAmount,
          workspaceAmount:
            scope.kind === 'workspace' ? expenses.workspaceAmount : null,
        },
        contribution: {
          amount: estimatedContribution({
            settlementAmount: entries.amount,
            productCostKnown: orders.known,
            expenses: expenses.amount,
          }),
          complete: isComplete(flags),
          flags,
          formula: CONTRIBUTION_FORMULA,
        },
        trend,
      },
    };
  }
}

/**
 * One row of the account comparison: the account's own groups, summed by the same functions as the totals,
 * so Σ rows + workspace-wide expenses = the workspace totals (product cost is rounded per row, which can
 * differ from the rounded total only with 4-decimal unit costs in several accounts; knownExact adds up).
 */
function accountRow(
  account: AccountRow,
  groups: Groups,
): DashboardAccountRowDto {
  const orders = summarizeOrders(
    groups.orders.filter((g) => g.accountId === account.id),
  );
  const entries = summarizeEntries(
    groups.entries.filter((g) => g.accountId === account.id),
  );
  const expenses = summarizeExpenses(
    groups.expenses.filter((g) => g.accountId === account.id),
  ).amount;
  return {
    id: account.id,
    displayName: account.displayName,
    status: account.status,
    orders: orders.count,
    orderValueDiscounted: orders.orderValueDiscounted,
    settlementAmount: entries.amount,
    productCostKnown: orders.known,
    expenses,
    contribution: estimatedContribution({
      settlementAmount: entries.amount,
      productCostKnown: orders.known,
      expenses,
    }),
    complete: isComplete(flagsOf(orders, entries)),
    cancelledOrReturnedOrders: orders.cancelledOrReturnedOrders,
  };
}
