import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  distinctUntilChanged,
  forkJoin,
  map,
  merge,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { describeApiError } from '../../core/api/api-error';
import {
  BASIS_HELP,
  BASIS_LABELS,
  DASHBOARD_BASES,
  DEFAULT_DASHBOARD_BASIS,
  Dashboard,
  DashboardBasis,
  DashboardQuery,
  MAX_DASHBOARD_RANGE_DAYS,
  NOT_PAYOUT_NOTE,
  STATUS_FILTER_HELP,
  TREND_GRANULARITIES,
  TrendGranularity,
} from '../../core/dashboard/dashboard.models';
import { DashboardApiService } from '../../core/dashboard/dashboard-api.service';
import { OrdersApiService } from '../../core/orders/orders-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { CLOCK } from '../../core/time/clock';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { CheckboxGroup, CheckboxOption } from '../../shared/checkbox-group/checkbox-group';
import { RANGE_PRESETS, daysInRange, presetRange } from '../../shared/date-presets/date-presets';
import { DateRange } from '../../shared/date-range/date-range';
import { FilterBar } from '../../shared/filter-bar/filter-bar';
import { formatCount, formatDateRange } from '../../shared/format/format';
import { CountPipe, DateRangePipe, DisplayDateTimePipe } from '../../shared/format/format.pipes';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { AccountComparison } from './account-comparison/account-comparison';
import { ApiStatus } from './api-status/api-status';
import { DashboardKpis } from './dashboard-kpis/dashboard-kpis';
import { DrillLink as DrillLinkTarget, LinkContext, ordersLink } from './dashboard-links';
import { DrillLink } from './drill-link/drill-link';
import {
  DEFAULT_RANGE,
  OverviewRange,
  OverviewScope,
  OverviewView,
  dashboardQuery,
  isCustomRangeValid,
  overviewParams,
  readOverviewView,
} from './overview-view';
import { SettlementBreakdown } from './settlement-breakdown/settlement-breakdown';
import { TrendChart } from './trend-chart/trend-chart';
import { LoadingState } from '../../shared/loading-state/loading-state';
import { ErrorState } from '../../shared/error-state/error-state';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { TableRegion } from '../../shared/table-region/table-region';

interface Target {
  kind: 'account' | 'workspace';
  id: string;
}

type DashboardState =
  | { kind: 'idle' }
  | { kind: 'loading'; key: string }
  | { kind: 'ready'; key: string; dashboard: Dashboard }
  | { kind: 'error'; key: string; message: string };

type StatusesState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: { status: string; count: number }[] }
  | { kind: 'error' };

const RANGE_OPTIONS: readonly { id: OverviewRange; label: string }[] = [
  ...RANGE_PRESETS,
  { id: 'custom', label: 'Custom range' },
];

/**
 * `/overview`: the dashboard of every seller account of the workspace, or of the shared selected
 * account, for a date range (presets on India's calendar, or custom), by order date or payment
 * date, optionally for some order statuses. Filters live in the URL query. Every number links to
 * the list behind it; the API status panel stays at the bottom.
 */
@Component({
  selector: 'app-overview-page',
  imports: [
    AccountComparison,
    ApiStatus,
    CheckboxGroup,
    CountPipe,
    DashboardKpis,
    DateRange,
    DateRangePipe,
    DisplayDateTimePipe,
    DrillLink,
    FilterBar,
    SellerAccountPicker,
    SettlementBreakdown,
    TrendChart,
    LoadingState,
    ErrorState,
    EmptyState,
    TableRegion,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview-page.html',
})
export class OverviewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(DashboardApiService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly context = inject(WorkspaceContextService);
  private readonly clock = inject(CLOCK);
  private readonly reloads = new Subject<void>();
  private readonly dateRange = viewChild<string, ElementRef<HTMLElement>>('dateRange', {
    read: ElementRef,
  });

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly bases = DASHBOARD_BASES;
  protected readonly basisLabels = BASIS_LABELS;
  protected readonly basisHelp = BASIS_HELP;
  protected readonly granularities = TREND_GRANULARITIES;
  protected readonly notPayout = NOT_PAYOUT_NOTE;
  protected readonly workspace = this.context.selected;

  protected readonly view = toSignal(this.route.queryParamMap.pipe(map(readOverviewView)), {
    requireSync: true,
  });
  /**
   * "Now" for the presets: read from the clock whenever the view changes and on every refresh /
   * retry, so a page left open past midnight in India moves its preset ranges on.
   */
  private readonly now = linkedSignal(() => {
    this.view();
    return this.clock();
  });
  /** The request's explicit dates and filters. */
  protected readonly query = computed(() => dashboardQuery(this.view(), this.now()));
  protected readonly hasFilters = computed(() => {
    const v = this.view();
    return v.range !== DEFAULT_RANGE || v.basis !== DEFAULT_DASHBOARD_BASIS || v.status.length > 0;
  });

  // The filter form; reset from the URL whenever it changes.
  protected readonly draftRange = linkedSignal<OverviewRange>(() => this.view().range);
  protected readonly draftFrom = linkedSignal(() => this.query().from ?? '');
  protected readonly draftTo = linkedSignal(() => this.query().to ?? '');
  protected readonly draftBasis = linkedSignal<DashboardBasis>(() => this.view().basis);
  protected readonly draftStatus = linkedSignal<readonly string[]>(() => this.view().status);
  protected readonly draftDates = computed(() => {
    const range = this.draftRange();
    return range === 'custom'
      ? { from: this.draftFrom(), to: this.draftTo() }
      : presetRange(range, this.now());
  });
  protected readonly statusHint = computed(() => STATUS_FILTER_HELP[this.draftBasis()]);
  /** Why the custom range cannot be applied (a reversed range is reported by the date inputs). */
  protected readonly customError = computed(() => {
    if (this.draftRange() !== 'custom') {
      return null;
    }
    const { from, to } = this.draftDates();
    if (from === '' || to === '') {
      return 'Enter both a start and an end date.';
    }
    if (from > to) {
      return null;
    }
    return daysInRange(from, to) > MAX_DASHBOARD_RANGE_DAYS
      ? `A range can be at most ${formatCount(MAX_DASHBOARD_RANGE_DAYS)} days long.`
      : null;
  });

  /** What the dashboard is for: the workspace, or the selected account; `null` until known. */
  private readonly target = computed<Target | null>(() => {
    if (this.view().scope === 'all') {
      const id = this.context.selectedId();
      return id === null ? null : { kind: 'workspace', id };
    }
    const id = this.selection.selectedId();
    return id === null ? null : { kind: 'account', id };
  });

  protected readonly state = signal<DashboardState>({ kind: 'idle' });
  /** Every seller account of the workspace, disabled ones too (from the last dashboard). */
  private readonly workspaceAccountIds = signal<string[] | null>(null);
  /** True while new filters load for the same account / workspace; the old numbers stay. */
  protected readonly busy = signal(false);
  protected readonly statuses = signal<StatusesState>({ kind: 'loading' });
  protected readonly statusOptions = computed<CheckboxOption[]>(() => {
    const statuses = this.statuses();
    return statuses.kind === 'ready'
      ? statuses.items.map((s) => ({
          value: s.status,
          label: `${s.status} (${formatCount(s.count)})`,
        }))
      : [];
  });
  protected readonly statusEmptyText = computed(() => {
    switch (this.statuses().kind) {
      case 'loading':
        return 'Loading statuses…';
      case 'error':
        return 'The statuses could not be loaded.';
      default:
        return 'No orders imported yet.';
    }
  });

  /** The filters the shown numbers were computed with (as the API echoes them), for the links. */
  protected readonly linkCtx = computed<LinkContext | null>(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return null;
    }
    const f = state.dashboard.filters;
    return {
      from: f.from,
      to: f.to,
      basis: f.basis,
      status: f.statuses,
      accountId: state.dashboard.scope.kind === 'account' ? state.dashboard.scope.id : null,
    };
  });
  protected readonly isEmpty = computed(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return false;
    }
    const d = state.dashboard;
    // `undatedEntries` counts every date, so it never keeps a range out of the empty state.
    return d.orders.count === 0 && d.settlements.count === 0 && d.expenses.count === 0;
  });
  protected readonly filterSummary = computed(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return '';
    }
    const f = state.dashboard.filters;
    const statuses = f.statuses.length === 0 ? 'every status' : f.statuses.join(', ');
    return `${formatDateRange(f.from, f.to)} · ${BASIS_LABELS[f.basis].toLowerCase()} · ${statuses}`;
  });
  /** Announced politely after each load. */
  protected readonly resultText = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `Dashboard updated: ${this.filterSummary()}.` : '';
  });

  constructor() {
    const request = computed(() => {
      const target = this.target();
      return target === null ? null : { target, query: this.query() };
    });
    merge(
      // The same request twice in a row is sent once; "Try again" always re-sends.
      toObservable(request).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
      this.reloads.pipe(map(() => request())),
    )
      .pipe(
        switchMap((req) =>
          req === null ? of<DashboardState>({ kind: 'idle' }) : this.load(req.target, req.query),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((next) => {
        const current = this.state();
        if (next.kind === 'loading' && current.kind === 'ready' && current.key === next.key) {
          this.busy.set(true);
          return;
        }
        this.busy.set(false);
        this.state.set(next);
        if (next.kind === 'ready' && next.dashboard.accounts) {
          const ids = next.dashboard.accounts.map((a) => a.id).sort();
          if (JSON.stringify(ids) !== JSON.stringify(this.workspaceAccountIds())) {
            this.workspaceAccountIds.set(ids);
          }
        }
      });

    // The status filter's options: the statuses in use in the account, or in every account of
    // the workspace (disabled ones too: the all-accounts totals include them).
    const statusSource = computed<string[] | null>(() => {
      if (this.view().scope === 'account') {
        const id = this.selection.selectedId();
        return id === null ? null : [id];
      }
      return this.workspaceAccountIds();
    });
    toObservable(statusSource)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap((ids) =>
          ids === null ? of<StatusesState>({ kind: 'loading' }) : this.loadStatuses(ids),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((statuses) => this.statuses.set(statuses));
  }

  protected selectScope(scope: OverviewScope): void {
    if (scope !== this.view().scope) {
      this.navigate({ ...this.view(), scope });
    }
  }

  protected applyFilters(): void {
    const range = this.draftRange();
    if (range === 'custom' && !isCustomRangeValid(this.draftFrom(), this.draftTo())) {
      this.dateRange()?.nativeElement.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    this.navigate({
      ...this.view(),
      range,
      customFrom: range === 'custom' ? this.draftFrom() : '',
      customTo: range === 'custom' ? this.draftTo() : '',
      basis: this.draftBasis(),
      status: this.draftStatus(),
    });
  }

  protected clearFilters(): void {
    this.navigate({
      ...this.view(),
      range: DEFAULT_RANGE,
      customFrom: '',
      customTo: '',
      basis: DEFAULT_DASHBOARD_BASIS,
      status: [],
    });
  }

  protected changeGranularity(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const granularity = (TREND_GRANULARITIES as readonly string[]).includes(value)
      ? (value as TrendGranularity)
      : null;
    this.navigate({ ...this.view(), granularity });
  }

  protected selectRange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const option = RANGE_OPTIONS.find((o) => o.id === value);
    if (!option) {
      return;
    }
    if (option.id === 'custom' && this.draftRange() !== 'custom') {
      // A custom range starts from the dates shown so far.
      const { from, to } = this.draftDates();
      this.draftFrom.set(from);
      this.draftTo.set(to);
    }
    this.draftRange.set(option.id);
  }

  protected selectBasis(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if ((DASHBOARD_BASES as readonly string[]).includes(value)) {
      this.draftBasis.set(value as DashboardBasis);
    }
  }

  protected statusLink(ctx: LinkContext, status: string): DrillLinkTarget | null {
    return ordersLink(ctx, { status: [status] });
  }

  /** Loads again with "now" read from the clock (a preset may have moved on). */
  protected refresh(): void {
    const before = JSON.stringify(this.query());
    this.now.set(this.clock());
    if (JSON.stringify(this.query()) === before) {
      this.reloads.next();
    }
    // Otherwise the new dates send the request by themselves.
  }

  private navigate(view: OverviewView): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: overviewParams(view) });
  }

  private load(target: Target, query: DashboardQuery): Observable<DashboardState> {
    const key = `${target.kind}:${target.id}`;
    const request =
      target.kind === 'workspace'
        ? this.api.forWorkspace(target.id, query)
        : this.api.forAccount(target.id, query);
    return request.pipe(
      map((dashboard): DashboardState => ({ kind: 'ready', key, dashboard })),
      catchError((error: unknown) =>
        of<DashboardState>({ kind: 'error', key, message: describeApiError(error) }),
      ),
      startWith<DashboardState>({ kind: 'loading', key }),
    );
  }

  /** Every account's statuses, merged (counts added), most common first. */
  private loadStatuses(accountIds: string[]): Observable<StatusesState> {
    if (accountIds.length === 0) {
      return of<StatusesState>({ kind: 'ready', items: [] });
    }
    return forkJoin(accountIds.map((id) => this.ordersApi.statuses(id))).pipe(
      map((lists): StatusesState => {
        const counts = new Map<string, number>();
        for (const list of lists) {
          for (const item of list.items) {
            counts.set(item.status, (counts.get(item.status) ?? 0) + item.count);
          }
        }
        const items = [...counts.entries()]
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
        return { kind: 'ready', items };
      }),
      catchError(() => of<StatusesState>({ kind: 'error' })),
      startWith<StatusesState>({ kind: 'loading' }),
    );
  }
}
