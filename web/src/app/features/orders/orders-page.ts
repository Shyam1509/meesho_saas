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
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  distinctUntilChanged,
  map,
  merge,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { describeApiError } from '../../core/api/api-error';
import { PagedResponse } from '../../core/api/paged-response';
import {
  DEFAULT_ORDER_SORT,
  ORDER_PAGE_SIZE,
  ORDER_SETTLEMENT_FILTERS,
  ORDER_SORTS,
  OrderSettlementFilter,
  OrderSort,
  OrderStatusCount,
  OrderSummary,
} from '../../core/orders/order.models';
import { OrdersApiService } from '../../core/orders/orders-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { CheckboxGroup, CheckboxOption } from '../../shared/checkbox-group/checkbox-group';
import { DateRange } from '../../shared/date-range/date-range';
import { FilterBar } from '../../shared/filter-bar/filter-bar';
import { formatCount, plural } from '../../shared/format/format';
import { Pager } from '../../shared/pager/pager';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import {
  compactParams,
  isDateRangeValid,
  readDate,
  readList,
  readOneOf,
  readPage,
  readText,
} from '../../shared/url-state/url-state';
import { OrdersTable } from './orders-table/orders-table';

/** The list as the URL query describes it (`?q&status…&from&to&paymentFrom&paymentTo&settlement&sort&page`). */
export interface OrdersView {
  q: string;
  status: readonly string[];
  /** Order date, `YYYY-MM-DD` or `''`. */
  from: string;
  to: string;
  /** Earliest matched settlement entry's payment date, `YYYY-MM-DD` or `''` (dashboard links). */
  paymentFrom: string;
  paymentTo: string;
  settlement: OrderSettlementFilter | null;
  sort: OrderSort;
  page: number;
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading'; accountId: string }
  | { kind: 'ready'; accountId: string; result: PagedResponse<OrderSummary> }
  | { kind: 'error'; accountId: string; message: string };

type StatusesState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: OrderStatusCount[] }
  | { kind: 'error' };

/** Reads the list view from the URL; an invalid value falls back to its default. */
export function readOrdersView(params: ParamMap): OrdersView {
  let from = readDate(params, 'from');
  let to = readDate(params, 'to');
  if (!isDateRangeValid(from, to)) {
    from = '';
    to = '';
  }
  let paymentFrom = readDate(params, 'paymentFrom');
  let paymentTo = readDate(params, 'paymentTo');
  if (!isDateRangeValid(paymentFrom, paymentTo)) {
    paymentFrom = '';
    paymentTo = '';
  }
  return {
    q: readText(params, 'q'),
    status: readList(params, 'status'),
    from,
    to,
    paymentFrom,
    paymentTo,
    settlement: readOneOf(params, 'settlement', ORDER_SETTLEMENT_FILTERS),
    sort: readOneOf(params, 'sort', ORDER_SORTS) ?? DEFAULT_ORDER_SORT,
    page: readPage(params),
  };
}

/**
 * `/orders`: the selected seller account's orders, searchable and filterable by status, order date
 * and whether a settlement is matched, sortable and paginated on the server. Filters, sort and page
 * live in the URL query, so a view can be bookmarked and the back button restores the previous
 * one. Each sub order links to its detail page.
 */
@Component({
  selector: 'app-orders-page',
  imports: [
    RouterLink,
    SellerAccountPicker,
    FilterBar,
    CheckboxGroup,
    DateRange,
    OrdersTable,
    Pager,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders-page.html',
})
export class OrdersPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(OrdersApiService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly reloads = new Subject<void>();
  private readonly dateRange = viewChild<string, ElementRef<HTMLElement>>('dateRange', {
    read: ElementRef,
  });
  private readonly paymentRange = viewChild<string, ElementRef<HTMLElement>>('paymentRange', {
    read: ElementRef,
  });

  protected readonly account = this.selection.selected;
  protected readonly view = toSignal(this.route.queryParamMap.pipe(map(readOrdersView)), {
    requireSync: true,
  });
  protected readonly hasFilters = computed(() => {
    const v = this.view();
    return (
      v.q !== '' ||
      v.status.length > 0 ||
      v.from !== '' ||
      v.to !== '' ||
      v.paymentFrom !== '' ||
      v.paymentTo !== '' ||
      !!v.settlement
    );
  });

  // What the filter form shows; reset from the URL whenever it changes (apply, back button).
  protected readonly draftQ = linkedSignal(() => this.view().q);
  protected readonly draftStatus = linkedSignal<readonly string[]>(() => this.view().status);
  protected readonly draftFrom = linkedSignal(() => this.view().from);
  protected readonly draftTo = linkedSignal(() => this.view().to);
  protected readonly draftPaymentFrom = linkedSignal(() => this.view().paymentFrom);
  protected readonly draftPaymentTo = linkedSignal(() => this.view().paymentTo);
  protected readonly draftSettlement = linkedSignal<string>(() => this.view().settlement ?? '');

  /** Overrides the URL's page while the URL catches up with an account switch. */
  private readonly pageOverride = signal<number | null>(null);
  protected readonly state = signal<ListState>({ kind: 'idle' });
  /** True while another page / filter of the same account loads; the table stays on screen. */
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
  /** Announced politely after each load. */
  protected readonly resultText = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `${plural(state.result.total, 'order')} found.` : '';
  });

  constructor() {
    const request = computed(() => {
      const accountId = this.selection.selectedId();
      const view = this.view();
      const page = this.pageOverride() ?? view.page;
      return accountId === null ? null : { accountId, view: { ...view, page } };
    });
    merge(
      // The same request twice in a row (e.g. the URL catching up with an account switch) is sent
      // once; "Try again" always re-sends.
      toObservable(request).pipe(distinctUntilChanged(sameRequest)),
      this.reloads.pipe(map(() => request())),
    )
      .pipe(
        switchMap((req) =>
          req === null ? of<ListState>({ kind: 'idle' }) : this.load(req.accountId, req.view),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((next) => {
        const current = this.state();
        if (
          next.kind === 'loading' &&
          current.kind === 'ready' &&
          current.accountId === next.accountId
        ) {
          this.busy.set(true);
          return;
        }
        this.busy.set(false);
        this.state.set(next);
      });

    toObservable(this.selection.selectedId)
      .pipe(
        switchMap((accountId) =>
          accountId === null
            ? of<StatusesState>({ kind: 'loading' })
            : this.loadStatuses(accountId),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((statuses) => this.statuses.set(statuses));
  }

  protected applyFilters(): void {
    if (!isDateRangeValid(this.draftFrom(), this.draftTo())) {
      this.dateRange()?.nativeElement.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    if (!isDateRangeValid(this.draftPaymentFrom(), this.draftPaymentTo())) {
      this.paymentRange()?.nativeElement.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    void this.navigate({
      q: this.draftQ().trim(),
      status: this.draftStatus(),
      from: this.draftFrom(),
      to: this.draftTo(),
      paymentFrom: this.draftPaymentFrom(),
      paymentTo: this.draftPaymentTo(),
      settlement: (ORDER_SETTLEMENT_FILTERS as readonly string[]).includes(this.draftSettlement())
        ? (this.draftSettlement() as OrderSettlementFilter)
        : null,
      sort: this.view().sort,
      page: 1,
    });
  }

  protected clearFilters(): void {
    void this.navigate({
      q: '',
      status: [],
      from: '',
      to: '',
      paymentFrom: '',
      paymentTo: '',
      settlement: null,
      sort: this.view().sort,
      page: 1,
    });
  }

  protected changeSort(sort: string): void {
    const next = (ORDER_SORTS as readonly string[]).includes(sort) ? (sort as OrderSort) : null;
    if (next !== null) {
      void this.navigate({ ...this.view(), sort: next, page: 1 });
    }
  }

  protected changePage(page: number): void {
    void this.navigate({ ...this.view(), page });
  }

  /**
   * Another account: its first page, same filters. Page 1 applies at once (no request for the old
   * page number of the new account) while the URL is updated.
   */
  protected onAccountChange(): void {
    if (this.view().page !== 1) {
      this.pageOverride.set(1);
      void this.navigate({ ...this.view(), page: 1 }).finally(() => this.pageOverride.set(null));
    }
  }

  protected retry(): void {
    this.reloads.next();
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private navigate(view: OrdersView): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: compactParams({
        q: view.q,
        status: view.status,
        from: view.from,
        to: view.to,
        paymentFrom: view.paymentFrom,
        paymentTo: view.paymentTo,
        settlement: view.settlement,
        sort: view.sort === DEFAULT_ORDER_SORT ? null : view.sort,
        page: view.page === 1 ? null : view.page,
      }),
    });
  }

  private load(accountId: string, view: OrdersView): Observable<ListState> {
    return this.api
      .list(accountId, {
        page: view.page,
        pageSize: ORDER_PAGE_SIZE,
        sort: view.sort,
        status: view.status,
        from: view.from || undefined,
        to: view.to || undefined,
        paymentFrom: view.paymentFrom || undefined,
        paymentTo: view.paymentTo || undefined,
        q: view.q || undefined,
        settlement: view.settlement ?? undefined,
      })
      .pipe(
        map((result): ListState => ({ kind: 'ready', accountId, result })),
        catchError((error: unknown) =>
          of<ListState>({ kind: 'error', accountId, message: describeApiError(error) }),
        ),
        startWith<ListState>({ kind: 'loading', accountId }),
      );
  }

  private loadStatuses(accountId: string): Observable<StatusesState> {
    return this.api.statuses(accountId).pipe(
      map((body): StatusesState => ({ kind: 'ready', items: body.items })),
      catchError(() => of<StatusesState>({ kind: 'error' })),
      startWith<StatusesState>({ kind: 'loading' }),
    );
  }
}

function sameRequest(
  a: { accountId: string; view: OrdersView } | null,
  b: { accountId: string; view: OrdersView } | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
