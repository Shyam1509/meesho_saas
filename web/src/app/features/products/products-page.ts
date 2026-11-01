import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  linkedSignal,
  signal,
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
  DEFAULT_PRODUCT_SORT,
  DEFAULT_PRODUCT_STATUS_FILTER,
  PRODUCT_COST_FILTERS,
  PRODUCT_COST_RULE,
  PRODUCT_PAGE_SIZE,
  PRODUCT_SORTS,
  PRODUCT_STATUS_FILTERS,
  ProductCostFilter,
  ProductDetail,
  ProductSort,
  ProductStatusFilter,
  ProductSummary,
  ProductSyncResult,
} from '../../core/products/product.models';
import { ProductsApiService } from '../../core/products/products-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { FilterBar } from '../../shared/filter-bar/filter-bar';
import { MISSING, plural } from '../../shared/format/format';
import { CountPipe, DisplayDatePipe, UnitCostPipe } from '../../shared/format/format.pipes';
import { Pager } from '../../shared/pager/pager';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { SortButton, ariaSort } from '../../shared/sort/sort';
import { compactParams, readOneOf, readPage, readText } from '../../shared/url-state/url-state';
import { ProductCreateDialog } from './product-create-dialog/product-create-dialog';

/** The list as the URL query describes it (`?q&status&cost&sort&page`). */
export interface ProductsView {
  q: string;
  status: ProductStatusFilter;
  cost: ProductCostFilter | null;
  sort: ProductSort;
  page: number;
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading'; accountId: string }
  | { kind: 'ready'; accountId: string; result: PagedResponse<ProductSummary> }
  | { kind: 'error'; accountId: string; message: string };

/** A success message; `productId` adds a link to that product. */
interface Notice {
  text: string;
  productId?: string;
}

/** Reads the list view from the URL; an invalid value falls back to its default. */
export function readProductsView(params: ParamMap): ProductsView {
  return {
    q: readText(params, 'q'),
    status: readOneOf(params, 'status', PRODUCT_STATUS_FILTERS) ?? DEFAULT_PRODUCT_STATUS_FILTER,
    cost: readOneOf(params, 'cost', PRODUCT_COST_FILTERS),
    sort: readOneOf(params, 'sort', PRODUCT_SORTS) ?? DEFAULT_PRODUCT_SORT,
    page: readPage(params),
  };
}

/** "Sync finished: 3 products created and 12 orders linked." */
export function describeSyncResult(result: ProductSyncResult): string {
  if (result.createdProducts === 0 && result.linkedOrders === 0) {
    return 'Already up to date: every SKU in your imported orders has a product, and every order is linked.';
  }
  return `Sync finished: ${plural(result.createdProducts, 'product')} created and ${plural(result.linkedOrders, 'order')} linked.`;
}

/**
 * `/products`: the selected seller account's products (one per SKU) with their current unit cost,
 * searchable, filterable by status and missing cost, sortable and paginated on the server; the view
 * lives in the URL query. Any member can sync products from the imported orders and add a product.
 */
@Component({
  selector: 'app-products-page',
  imports: [
    RouterLink,
    SellerAccountPicker,
    FilterBar,
    Pager,
    SortButton,
    CountPipe,
    DisplayDatePipe,
    UnitCostPipe,
    ProductCreateDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products-page.html',
})
export class ProductsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ProductsApiService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new Subject<void>();

  protected readonly missing = MISSING;
  protected readonly costRule = PRODUCT_COST_RULE;
  protected readonly account = this.selection.selected;
  protected readonly view = toSignal(this.route.queryParamMap.pipe(map(readProductsView)), {
    requireSync: true,
  });
  protected readonly hasFilters = computed(() => {
    const v = this.view();
    return v.q !== '' || v.status !== DEFAULT_PRODUCT_STATUS_FILTER || v.cost !== null;
  });

  protected readonly draftQ = linkedSignal(() => this.view().q);
  protected readonly draftStatus = linkedSignal<string>(() => this.view().status);
  protected readonly draftCost = linkedSignal<string>(() => this.view().cost ?? '');

  /** Overrides the URL's page while the URL catches up with an account switch. */
  private readonly pageOverride = signal<number | null>(null);
  protected readonly state = signal<ListState>({ kind: 'idle' });
  protected readonly busy = signal(false);
  protected readonly syncing = signal(false);
  protected readonly syncError = signal<string | null>(null);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly adding = signal(false);
  protected readonly resultText = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `${plural(state.result.total, 'product')} found.` : '';
  });

  constructor() {
    const request = computed(() => {
      const accountId = this.selection.selectedId();
      const view = this.view();
      const page = this.pageOverride() ?? view.page;
      return accountId === null ? null : { accountId, view: { ...view, page } };
    });
    merge(
      toObservable(request).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
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
  }

  protected applyFilters(): void {
    const status = this.draftStatus();
    const cost = this.draftCost();
    void this.navigate({
      q: this.draftQ().trim(),
      status: (PRODUCT_STATUS_FILTERS as readonly string[]).includes(status)
        ? (status as ProductStatusFilter)
        : DEFAULT_PRODUCT_STATUS_FILTER,
      cost: (PRODUCT_COST_FILTERS as readonly string[]).includes(cost)
        ? (cost as ProductCostFilter)
        : null,
      sort: this.view().sort,
      page: 1,
    });
  }

  protected clearFilters(): void {
    void this.navigate({
      q: '',
      status: DEFAULT_PRODUCT_STATUS_FILTER,
      cost: null,
      sort: this.view().sort,
      page: 1,
    });
  }

  protected changeSort(sort: string): void {
    if ((PRODUCT_SORTS as readonly string[]).includes(sort)) {
      void this.navigate({ ...this.view(), sort: sort as ProductSort, page: 1 });
    }
  }

  protected changePage(page: number): void {
    void this.navigate({ ...this.view(), page });
  }

  protected onAccountChange(): void {
    this.notice.set(null);
    this.syncError.set(null);
    if (this.view().page !== 1) {
      this.pageOverride.set(1);
      void this.navigate({ ...this.view(), page: 1 }).finally(() => this.pageOverride.set(null));
    }
  }

  protected retry(): void {
    this.reloads.next();
  }

  /** `POST …/products/sync`, then the list again with the counts in a notice. */
  protected sync(): void {
    const accountId = this.selection.selectedId();
    if (accountId === null || this.syncing()) {
      return;
    }
    this.syncing.set(true);
    this.syncError.set(null);
    this.notice.set(null);
    this.api
      .sync(accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.syncing.set(false);
          this.notice.set({ text: describeSyncResult(result) });
          this.reloads.next();
        },
        error: (error: unknown) => {
          this.syncing.set(false);
          this.syncError.set(describeApiError(error));
        },
      });
  }

  protected openAdd(): void {
    this.notice.set(null);
    this.adding.set(true);
  }

  protected onAdded(product: ProductDetail): void {
    this.adding.set(false);
    this.notice.set({
      text: `Added product ${product.sku}. Open it to enter its unit cost.`,
      productId: product.id,
    });
    this.reloads.next();
  }

  protected sortFor(key: string): string | null {
    return ariaSort(this.view().sort, key);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private navigate(view: ProductsView): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: compactParams({
        q: view.q,
        status: view.status === DEFAULT_PRODUCT_STATUS_FILTER ? null : view.status,
        cost: view.cost,
        sort: view.sort === DEFAULT_PRODUCT_SORT ? null : view.sort,
        page: view.page === 1 ? null : view.page,
      }),
    });
  }

  private load(accountId: string, view: ProductsView): Observable<ListState> {
    return this.api
      .list(accountId, {
        page: view.page,
        pageSize: PRODUCT_PAGE_SIZE,
        sort: view.sort,
        q: view.q || undefined,
        status: view.status,
        cost: view.cost ?? undefined,
      })
      .pipe(
        map((result): ListState => ({ kind: 'ready', accountId, result })),
        catchError((error: unknown) =>
          of<ListState>({ kind: 'error', accountId, message: describeApiError(error) }),
        ),
        startWith<ListState>({ kind: 'loading', accountId }),
      );
  }
}
