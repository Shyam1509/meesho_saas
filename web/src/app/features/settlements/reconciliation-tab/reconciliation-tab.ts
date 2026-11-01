import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { describeApiError } from '../../../core/api/api-error';
import { PagedResponse } from '../../../core/api/paged-response';
import { userName } from '../../../core/api/refs';
import { ORDER_PAGE_SIZE, OrderSummary } from '../../../core/orders/order.models';
import { ReconciliationApiService } from '../../../core/reconciliation/reconciliation-api.service';
import {
  ReconciliationOverview,
  RunSummary,
  runStatusLabel,
  runTriggerLabel,
} from '../../../core/reconciliation/reconciliation.models';
import {
  AS_REPORTED_NOTE,
  SETTLEMENT_PAGE_SIZE,
  SettlementEntry,
} from '../../../core/settlements/settlement.models';
import { WorkspaceContextService } from '../../../core/workspaces/workspace-context.service';
import { Amount } from '../../../shared/amount/amount';
import { formatCount, plural } from '../../../shared/format/format';
import { CountPipe, DisplayDateTimePipe } from '../../../shared/format/format.pipes';
import {
  Loadable,
  keepPreviousWhileLoading,
  toLoadable,
} from '../../../shared/loadable/loadable';
import { Pager } from '../../../shared/pager/pager';
import { OrdersTable } from '../../orders/orders-table/orders-table';
import { MatchOrderDialog } from '../match-order-dialog/match-order-dialog';
import { SettlementEntriesTable } from '../settlement-entries-table/settlement-entries-table';
import { LoadingState } from '../../../shared/loading-state/loading-state';
import { ErrorState } from '../../../shared/error-state/error-state';
import { TableRegion } from '../../../shared/table-region/table-region';

/** Page size of the run history. */
export const RUN_PAGE_SIZE = 10;

/** The text announced after a "Run matching now". */
export function describeRun(run: RunSummary): string {
  if (run.status === 'failed') {
    return `Matching failed${run.failureMessage ? `: ${run.failureMessage}` : '.'}`;
  }
  if (run.status === 'running') {
    return 'Matching has started. Refresh in a moment to see the result.';
  }
  return (
    `Matching finished: ${plural(run.matchedCount ?? 0, 'entry', 'entries')} newly matched. ` +
    `${formatCount(run.unmatchedSettlementCount)} unmatched settlement ${
      run.unmatchedSettlementCount === 1 ? 'entry' : 'entries'
    } and ${formatCount(run.unmatchedOrderCount)} ${
      run.unmatchedOrderCount === 1 ? 'order' : 'orders'
    } without a settlement remain.`
  );
}

/**
 * The "Reconciliation" tab for one account: overview counts and as-reported sums, the last
 * matching run with "Run matching now" (any member), the unmatched settlement entries (owners can
 * match one to an order by hand), the orders without a matched settlement (by status) and the run
 * history. Every action refreshes all of it. Re-created per account by the page.
 */
@Component({
  selector: 'app-reconciliation-tab',
  imports: [
    RouterLink,
    Amount,
    CountPipe,
    DisplayDateTimePipe,
    MatchOrderDialog,
    OrdersTable,
    Pager,
    SettlementEntriesTable,
    LoadingState,
    ErrorState,
    TableRegion,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reconciliation-tab.html',
})
export class ReconciliationTab {
  readonly accountId = input.required<string>();
  readonly accountName = input('');

  private readonly api = inject(ReconciliationApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly note = AS_REPORTED_NOTE;
  protected readonly isOwner = inject(WorkspaceContextService).isOwner;
  protected readonly runTriggerLabel = runTriggerLabel;
  protected readonly runStatusLabel = runStatusLabel;
  protected readonly userName = userName;

  /** Bumped after a run, match or anything else that changes the data: everything reloads. */
  private readonly version = signal(0);
  protected readonly unmatchedPage = signal(1);
  protected readonly withoutPage = signal(1);
  /** Raw status, or `''` for all. */
  protected readonly withoutStatus = signal('');
  protected readonly runsPage = signal(1);

  protected readonly overview = signal<Loadable<ReconciliationOverview>>({ kind: 'loading' });
  protected readonly unmatched = signal<Loadable<PagedResponse<SettlementEntry>>>({
    kind: 'loading',
  });
  protected readonly without = signal<Loadable<PagedResponse<OrderSummary>>>({ kind: 'loading' });
  protected readonly runs = signal<Loadable<PagedResponse<RunSummary>>>({ kind: 'loading' });

  protected readonly running = signal(false);
  protected readonly runError = signal<string | null>(null);
  protected readonly notice = signal('');
  /** The run that just failed (its message is shown as an error, not as a notice). */
  protected readonly failedRun = signal<string | null>(null);
  protected readonly matchTarget = signal<SettlementEntry | null>(null);

  /** The status filter's options: the statuses of orders without a settlement, with counts. */
  protected readonly statusOptions = computed(() => {
    const overview = this.overview();
    return overview.kind === 'ready' ? overview.value.withoutSettlementByStatus : [];
  });

  constructor() {
    const overviewKey = computed(() => ({ accountId: this.accountId(), v: this.version() }));
    toObservable(overviewKey)
      .pipe(
        switchMap(({ accountId }) => toLoadable(this.api.overview(accountId))),
        keepPreviousWhileLoading(),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.overview.set(state));

    const unmatchedKey = computed(() => ({
      accountId: this.accountId(),
      page: this.unmatchedPage(),
      v: this.version(),
    }));
    toObservable(unmatchedKey)
      .pipe(
        switchMap(({ accountId, page }) =>
          toLoadable(
            this.api.unmatchedSettlements(accountId, { page, pageSize: SETTLEMENT_PAGE_SIZE }),
          ),
        ),
        keepPreviousWhileLoading(),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        // A page past the end (entries matched elsewhere meanwhile): go to the last one.
        if (state.kind === 'ready' && state.value.items.length === 0 && state.value.total > 0) {
          const lastPage = Math.ceil(state.value.total / Math.max(1, state.value.pageSize));
          if (lastPage < this.unmatchedPage()) {
            this.unmatchedPage.set(lastPage);
            return;
          }
        }
        this.unmatched.set(state);
      });

    const withoutKey = computed(() => ({
      accountId: this.accountId(),
      page: this.withoutPage(),
      status: this.withoutStatus(),
      v: this.version(),
    }));
    toObservable(withoutKey)
      .pipe(
        switchMap(({ accountId, page, status }) =>
          toLoadable(
            this.api.ordersWithoutSettlement(accountId, {
              page,
              pageSize: ORDER_PAGE_SIZE,
              status: status ? [status] : undefined,
            }),
          ),
        ),
        keepPreviousWhileLoading(),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.without.set(state));

    const runsKey = computed(() => ({
      accountId: this.accountId(),
      page: this.runsPage(),
      v: this.version(),
    }));
    toObservable(runsKey)
      .pipe(
        switchMap(({ accountId, page }) =>
          toLoadable(this.api.runs(accountId, { page, pageSize: RUN_PAGE_SIZE })),
        ),
        keepPreviousWhileLoading(),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.runs.set(state));
  }

  /** Reloads everything (after an action, or "Try again"). */
  protected refresh(): void {
    this.version.update((v) => v + 1);
  }

  protected runNow(): void {
    if (this.running()) {
      return;
    }
    this.running.set(true);
    this.runError.set(null);
    this.failedRun.set(null);
    this.notice.set('');
    this.api
      .run(this.accountId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.running.set(false);
          if (run.status === 'failed') {
            this.failedRun.set(describeRun(run));
          } else {
            this.notice.set(describeRun(run));
          }
          this.unmatchedPage.set(1);
          this.withoutPage.set(1);
          this.runsPage.set(1);
          this.refresh();
        },
        error: (error: unknown) => {
          // The server's reason (e.g. 409: an import is running). A run that started and failed
          // is recorded, so reload to show it as the last run and in the history.
          this.running.set(false);
          this.runError.set(describeApiError(error));
          this.refresh();
        },
      });
  }

  protected changeWithoutStatus(event: Event): void {
    this.withoutStatus.set((event.target as HTMLSelectElement).value);
    this.withoutPage.set(1);
  }

  protected askMatch(entry: SettlementEntry): void {
    if (this.isOwner()) {
      this.matchTarget.set(entry);
    }
  }

  protected onMatched(entry: SettlementEntry): void {
    this.matchTarget.set(null);
    // One entry fewer: stay on a page that still exists (never an empty last page).
    const unmatched = this.unmatched();
    if (unmatched.kind === 'ready') {
      const { total, pageSize } = unmatched.value;
      const lastPage = Math.max(1, Math.ceil((total - 1) / Math.max(1, pageSize)));
      this.unmatchedPage.update((page) => Math.min(page, lastPage));
    }
    this.notice.set(
      `Matched entry ${entry.transactionId ?? entry.subOrderNo ?? entry.id} to order ${
        entry.match.orderSubOrderNo ?? entry.match.orderId ?? ''
      }.`,
    );
    this.refresh();
  }

  protected closeMatch(): void {
    this.matchTarget.set(null);
  }
}
