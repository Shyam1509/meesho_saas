import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Dashboard, DashboardAccountRow } from '../../../core/dashboard/dashboard.models';
import { SelectedSellerAccountService } from '../../../core/seller-accounts/selected-seller-account.service';
import { Amount } from '../../../shared/amount/amount';
import { compareDecimals, negateDecimal, sumDecimals } from '../../../shared/decimal/decimal';
import { CountPipe } from '../../../shared/format/format.pipes';
import { SortButton, ariaSort, parseSort } from '../../../shared/sort/sort';
import {
  DrillLink as DrillLinkTarget,
  LinkContext,
  expensesLink,
  ordersLink,
  productCostLink,
  settlementsLink,
} from '../dashboard-links';
import { DrillLink } from '../drill-link/drill-link';
import { overviewParams, OverviewView } from '../overview-view';

export type ComparisonKey =
  | 'displayName'
  | 'orders'
  | 'orderValueDiscounted'
  | 'settlementAmount'
  | 'productCostKnown'
  | 'expenses'
  | 'contribution';

const AMOUNT_KEYS = [
  'orderValueDiscounted',
  'settlementAmount',
  'productCostKnown',
  'expenses',
  'contribution',
] as const;

/** The sums of the account rows; amounts `null` when no row has one. */
export interface ComparisonTotals {
  orders: number;
  orderValueDiscounted: string | null;
  settlementAmount: string | null;
  productCostKnown: string | null;
  expenses: string | null;
  contribution: string | null;
}

/** Exact totals of the account rows (decimal strings added without rounding). */
export function comparisonTotals(rows: readonly DashboardAccountRow[]): ComparisonTotals {
  return {
    orders: rows.reduce((sum, r) => sum + r.orders, 0),
    orderValueDiscounted: sumDecimals(rows.map((r) => r.orderValueDiscounted)),
    settlementAmount: sumDecimals(rows.map((r) => r.settlementAmount)),
    productCostKnown: sumDecimals(rows.map((r) => r.productCostKnown)),
    expenses: sumDecimals(rows.map((r) => r.expenses)),
    contribution: sumDecimals(rows.map((r) => r.contribution)),
  };
}

/**
 * Sorts by `sort` (`-` prefix = descending). Amounts compare exactly; a missing amount always
 * comes last, whichever the direction; ties keep the name order.
 */
export function sortComparison(
  rows: readonly DashboardAccountRow[],
  sort: string,
): DashboardAccountRow[] {
  const { key, direction } = parseSort(sort);
  const sign = direction === 'ascending' ? 1 : -1;
  const byName = (a: DashboardAccountRow, b: DashboardAccountRow) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    let result: number;
    if (key === 'displayName') {
      result = sign * byName(a, b);
    } else if (key === 'orders') {
      result = sign * (a.orders - b.orders);
    } else if ((AMOUNT_KEYS as readonly string[]).includes(key)) {
      const k = key as (typeof AMOUNT_KEYS)[number];
      const [va, vb] = [a[k], b[k]];
      if (va === null || vb === null) {
        result = va === vb ? 0 : va === null ? 1 : -1;
      } else {
        result = sign * compareDecimals(va, vb);
      }
    } else {
      result = 0;
    }
    return result !== 0 ? result : byName(a, b);
  });
}

/**
 * The all-accounts dashboard's comparison: one row per seller account (disabled ones included and
 * marked), sortable on every column, with the total of the account rows and, below it, the
 * workspace-wide expenses and the workspace total (what the cards above show). An active
 * account's numbers open its lists; its name opens its own dashboard.
 */
@Component({
  selector: 'app-account-comparison',
  imports: [RouterLink, Amount, CountPipe, DrillLink, SortButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './account-comparison.html',
})
export class AccountComparison {
  readonly dashboard = input.required<Dashboard>();
  /** The dashboard filters; `accountId` is replaced per row. */
  readonly ctx = input.required<LinkContext>();
  /** The current view, for each account's "own dashboard" link. */
  readonly view = input.required<OverviewView>();

  private readonly selection = inject(SelectedSellerAccountService);

  protected readonly sort = signal<string>('displayName');
  protected readonly ariaSort = ariaSort;

  protected readonly rows = computed(() =>
    sortComparison(this.dashboard().accounts ?? [], this.sort()),
  );
  protected readonly totals = computed(() => comparisonTotals(this.dashboard().accounts ?? []));
  protected readonly workspaceExpenses = computed(() => this.dashboard().expenses.workspaceAmount);
  protected readonly workspaceExpensesNegated = computed(() =>
    negateDecimal(this.workspaceExpenses()),
  );
  /** Active accounts the lists can switch to. */
  private readonly activeIds = computed(() => {
    const state = this.selection.state();
    return new Set(state.kind === 'ready' ? state.accounts.map((a) => a.id) : []);
  });
  protected readonly accountDashboardParams = computed(() =>
    overviewParams({ ...this.view(), scope: 'account' }),
  );

  protected changeSort(sort: string): void {
    this.sort.set(sort);
  }

  protected linkable(row: DashboardAccountRow): boolean {
    return row.status === 'active' && this.activeIds().has(row.id);
  }

  protected rowCtx(row: DashboardAccountRow): LinkContext | null {
    return this.linkable(row) ? { ...this.ctx(), accountId: row.id } : null;
  }

  protected ordersLink(row: DashboardAccountRow): DrillLinkTarget | null {
    const ctx = this.rowCtx(row);
    return ctx ? ordersLink(ctx) : null;
  }

  protected productCostLink(row: DashboardAccountRow): DrillLinkTarget | null {
    const ctx = this.rowCtx(row);
    return ctx ? productCostLink(ctx) : null;
  }

  protected settlementsLink(row: DashboardAccountRow): DrillLinkTarget | null {
    const ctx = this.rowCtx(row);
    return ctx ? settlementsLink(ctx) : null;
  }

  protected expensesLink(row: DashboardAccountRow): DrillLinkTarget | null {
    const ctx = this.rowCtx(row);
    return ctx ? expensesLink(ctx) : null;
  }

  protected openDashboard(row: DashboardAccountRow): void {
    this.selection.select(row.id);
  }
}
