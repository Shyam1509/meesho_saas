import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
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
import { userName } from '../../core/api/refs';
import {
  DEFAULT_EXPENSE_SORT,
  DOUBLE_COUNTING_NOTE,
  EXPENSE_PAGE_SIZE,
  EXPENSE_SORTS,
  Expense,
  ExpenseCategory,
  ExpenseListQuery,
  ExpenseListResponse,
  ExpenseSort,
} from '../../core/expenses/expense.models';
import { ExpensesApiService } from '../../core/expenses/expenses-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { Amount } from '../../shared/amount/amount';
import { CheckboxGroup, CheckboxOption } from '../../shared/checkbox-group/checkbox-group';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { DateRange } from '../../shared/date-range/date-range';
import { FilterBar } from '../../shared/filter-bar/filter-bar';
import { MISSING, formatDate, formatInr, plural } from '../../shared/format/format';
import { DisplayDatePipe, DisplayDateTimePipe } from '../../shared/format/format.pipes';
import { Pager } from '../../shared/pager/pager';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { SortButton, ariaSort } from '../../shared/sort/sort';
import {
  compactParams,
  isDateRangeValid,
  readDate,
  readList,
  readPage,
} from '../../shared/url-state/url-state';
import { ExpenseFormDialog, ExpenseTarget } from './expense-form-dialog/expense-form-dialog';
import { LoadingState } from '../../shared/loading-state/loading-state';
import { ErrorState } from '../../shared/error-state/error-state';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { TableRegion } from '../../shared/table-region/table-region';

/** `account`: the selected seller account's expenses. `workspace`: workspace-wide ones. */
export type ExpensesScope = 'account' | 'workspace';

/** The list as the URL query describes it (`?scope&includeAccounts&from&to&category…&sort&page`). */
export interface ExpensesView {
  scope: ExpensesScope;
  /** Workspace view only: also list every seller account's expenses (API `scope=all`). */
  includeAccounts: boolean;
  /** Expense date, `YYYY-MM-DD` or `''`. */
  from: string;
  to: string;
  category: readonly string[];
  sort: ExpenseSort;
  page: number;
}

/** Whose expenses a request lists. */
type ListTarget =
  | { kind: 'account'; id: string }
  | { kind: 'workspace'; id: string; includeAccounts: boolean };

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading'; key: string }
  | { kind: 'ready'; key: string; result: ExpenseListResponse }
  | { kind: 'error'; key: string; message: string };

type CategoriesState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: ExpenseCategory[] }
  | { kind: 'error'; message: string };

/** An open add / edit dialog. */
type EditorState = { mode: 'add'; target: ExpenseTarget } | { mode: 'edit'; expense: Expense };

/** A category key as the API uses them. */
const CATEGORY_KEY = /^[a-z0-9_]+$/;

/** Reads the list view from the URL; an invalid value falls back to its default. */
export function readExpensesView(params: ParamMap): ExpensesView {
  let from = readDate(params, 'from');
  let to = readDate(params, 'to');
  if (!isDateRangeValid(from, to)) {
    from = '';
    to = '';
  }
  const scope: ExpensesScope = params.get('scope') === 'workspace' ? 'workspace' : 'account';
  const sort = params.get('sort');
  return {
    scope,
    includeAccounts: scope === 'workspace' && params.get('includeAccounts') === 'true',
    from,
    to,
    category: readList(params, 'category').filter((c) => CATEGORY_KEY.test(c)),
    sort:
      sort !== null && (EXPENSE_SORTS as readonly string[]).includes(sort)
        ? (sort as ExpenseSort)
        : DEFAULT_EXPENSE_SORT,
    page: readPage(params),
  };
}

/**
 * `/expenses`: the business costs Meesho's reports don't contain, either of the selected seller
 * account or workspace-wide (optionally with every account's), filterable by date and category,
 * sortable and paginated on the server, with the total of every filtered expense. Owners add, edit
 * and delete; members read. The note about counting costs twice stays on screen.
 */
@Component({
  selector: 'app-expenses-page',
  imports: [
    SellerAccountPicker,
    FilterBar,
    DateRange,
    CheckboxGroup,
    Pager,
    SortButton,
    Amount,
    DisplayDatePipe,
    DisplayDateTimePipe,
    ConfirmDialog,
    ExpenseFormDialog,
    LoadingState,
    ErrorState,
    EmptyState,
    TableRegion,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expenses-page.html',
})
export class ExpensesPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ExpensesApiService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly context = inject(WorkspaceContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new Subject<void>();
  private readonly categoryReloads = new Subject<void>();
  private readonly dateRange = viewChild<string, ElementRef<HTMLElement>>('dateRange', {
    read: ElementRef,
  });

  protected readonly missing = MISSING;
  protected readonly doubleCountingNote = DOUBLE_COUNTING_NOTE;
  protected readonly userName = userName;
  protected readonly plural = plural;
  protected readonly workspace = this.context.selected;
  protected readonly isOwner = this.context.isOwner;
  protected readonly account = this.selection.selected;
  /** The view as the URL says it, category keys unchecked. */
  private readonly urlView = toSignal(this.route.queryParamMap.pipe(map(readExpensesView)), {
    requireSync: true,
  });
  /**
   * The view the page uses: the URL's, keeping only category keys the API lists (an old or edited
   * link with an unknown key would otherwise make the API answer 400). Until the categories have
   * loaded (or if they fail), the keys are kept as they are.
   */
  protected readonly view = computed<ExpensesView>(() => {
    const view = this.urlView();
    const categories = this.categories();
    if (categories.kind !== 'ready' || view.category.length === 0) {
      return view;
    }
    const known = new Set(categories.items.map((c) => c.key));
    const category = view.category.filter((c) => known.has(c));
    return category.length === view.category.length ? view : { ...view, category };
  });
  protected readonly hasFilters = computed(() => {
    const v = this.view();
    return v.from !== '' || v.to !== '' || v.category.length > 0;
  });

  protected readonly draftFrom = linkedSignal(() => this.view().from);
  protected readonly draftTo = linkedSignal(() => this.view().to);
  protected readonly draftCategory = linkedSignal<readonly string[]>(() => this.view().category);

  private readonly pageOverride = signal<number | null>(null);
  protected readonly state = signal<ListState>({ kind: 'idle' });
  protected readonly busy = signal(false);
  protected readonly categories = signal<CategoriesState>({ kind: 'loading' });
  protected readonly categoryOptions = computed<CheckboxOption[]>(() => {
    const categories = this.categories();
    return categories.kind === 'ready'
      ? categories.items.map((c) => ({ value: c.key, label: c.label }))
      : [];
  });
  protected readonly categoryEmptyText = computed(() =>
    this.categories().kind === 'error'
      ? 'The categories could not be loaded.'
      : 'Loading categories…',
  );
  protected readonly categoryList = computed<readonly ExpenseCategory[]>(() => {
    const categories = this.categories();
    return categories.kind === 'ready' ? categories.items : [];
  });

  /** Whose expenses the list shows now; `null` until an account / workspace is available. */
  protected readonly target = computed<ListTarget | null>(() => {
    const view = this.view();
    if (view.scope === 'account') {
      const accountId = this.selection.selectedId();
      return accountId === null ? null : { kind: 'account', id: accountId };
    }
    const workspaceId = this.context.selectedId();
    return workspaceId === null
      ? null
      : { kind: 'workspace', id: workspaceId, includeAccounts: view.includeAccounts };
  });
  /** The workspace view with account expenses: rows say which account they belong to. */
  protected readonly showOwnerColumn = computed(
    () => this.view().scope === 'workspace' && this.view().includeAccounts,
  );
  protected readonly listHeading = computed(() => {
    const view = this.view();
    if (view.scope === 'account') {
      return `Expenses of ${this.account()?.displayName ?? 'the seller account'}`;
    }
    const name = this.workspace()?.name ?? 'the workspace';
    return view.includeAccounts
      ? `All expenses in ${name}, workspace-wide and per seller account`
      : `Workspace-wide expenses of ${name}`;
  });
  protected readonly resultText = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `${plural(state.result.total, 'expense')} found.` : '';
  });

  protected readonly notice = signal('');
  protected readonly editor = signal<EditorState | null>(null);
  protected readonly deleteTarget = signal<Expense | null>(null);
  protected readonly deletePending = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  constructor() {
    const request = computed(() => {
      const target = this.target();
      const view = this.view();
      // A category filter waits for the categories, so unknown keys can be left out first.
      if (view.category.length > 0 && this.categories().kind === 'loading') {
        return null;
      }
      const page = this.pageOverride() ?? view.page;
      return target === null ? null : { target, view: { ...view, page } };
    });
    merge(
      toObservable(request).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
      this.reloads.pipe(map(() => request())),
    )
      .pipe(
        switchMap((req) =>
          req === null ? of<ListState>({ kind: 'idle' }) : this.load(req.target, req.view),
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
      });

    this.categoryReloads
      .pipe(
        startWith(undefined),
        switchMap(() =>
          this.api.categories().pipe(
            map((body): CategoriesState => ({ kind: 'ready', items: body.items })),
            catchError((error: unknown) =>
              of<CategoriesState>({ kind: 'error', message: describeApiError(error) }),
            ),
            startWith<CategoriesState>({ kind: 'loading' }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.categories.set(state));
  }

  // --- View ---

  protected changeScope(scope: string): void {
    if (scope !== 'account' && scope !== 'workspace') {
      return;
    }
    this.notice.set('');
    void this.navigate({ ...this.view(), scope, includeAccounts: false, page: 1 });
  }

  protected changeIncludeAccounts(include: boolean): void {
    this.notice.set('');
    void this.navigate({ ...this.view(), includeAccounts: include, page: 1 });
  }

  protected applyFilters(): void {
    if (!isDateRangeValid(this.draftFrom(), this.draftTo())) {
      this.dateRange()?.nativeElement.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    void this.navigate({
      ...this.view(),
      from: this.draftFrom(),
      to: this.draftTo(),
      category: this.draftCategory(),
      page: 1,
    });
  }

  protected clearFilters(): void {
    void this.navigate({ ...this.view(), from: '', to: '', category: [], page: 1 });
  }

  protected changeSort(sort: string): void {
    if ((EXPENSE_SORTS as readonly string[]).includes(sort)) {
      void this.navigate({ ...this.view(), sort: sort as ExpenseSort, page: 1 });
    }
  }

  protected changePage(page: number): void {
    void this.navigate({ ...this.view(), page });
  }

  protected onAccountChange(): void {
    this.notice.set('');
    if (this.view().page !== 1) {
      this.pageOverride.set(1);
      void this.navigate({ ...this.view(), page: 1 }).finally(() => this.pageOverride.set(null));
    }
  }

  protected retry(): void {
    this.reloads.next();
  }

  protected retryCategories(): void {
    this.categoryReloads.next();
  }

  protected sortFor(key: string): string | null {
    return ariaSort(this.view().sort, key);
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** "Workspace-wide", or the seller account's name. */
  protected belongsTo(expense: Expense): string {
    if (expense.scope === 'workspace' || expense.sellerAccountId === null) {
      return 'Workspace-wide';
    }
    const state = this.selection.state();
    const account =
      state.kind === 'ready' ? state.accounts.find((a) => a.id === expense.sellerAccountId) : null;
    return account?.displayName ?? `Seller account ${expense.sellerAccountId}`;
  }

  // --- Add / edit / delete (owners) ---

  protected openAdd(): void {
    if (!this.isOwner() || this.categories().kind !== 'ready') {
      return;
    }
    const target = this.addTarget();
    if (target === null) {
      return;
    }
    this.notice.set('');
    this.editor.set({ mode: 'add', target });
  }

  protected openEdit(expense: Expense): void {
    if (!this.isOwner() || this.categories().kind !== 'ready') {
      return;
    }
    this.notice.set('');
    this.editor.set({ mode: 'edit', expense });
  }

  protected editScopeLabel(expense: Expense): string {
    return expense.scope === 'workspace'
      ? `the whole workspace (${this.workspace()?.name ?? 'workspace-wide'})`
      : `the seller account ${this.belongsTo(expense)}`;
  }

  protected onSaved(saved: Expense): void {
    const wasNew = this.editor()?.mode === 'add';
    this.editor.set(null);
    this.notice.set(
      `${wasNew ? 'Added' : 'Saved'} the ${saved.categoryLabel} expense of ${formatInr(saved.amount)} on ${formatDate(saved.expenseDate)}.`,
    );
    this.reloads.next();
  }

  protected askDelete(expense: Expense): void {
    if (!this.isOwner()) {
      return;
    }
    this.notice.set('');
    this.deleteError.set(null);
    this.deleteTarget.set(expense);
  }

  protected cancelDelete(): void {
    if (!this.deletePending()) {
      this.deleteTarget.set(null);
      this.deleteError.set(null);
    }
  }

  protected confirmDelete(): void {
    const expense = this.deleteTarget();
    if (expense === null || this.deletePending()) {
      return;
    }
    this.deletePending.set(true);
    this.deleteError.set(null);
    this.api
      .delete(expense.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deletePending.set(false);
          this.deleteTarget.set(null);
          this.notice.set(
            `Deleted the ${expense.categoryLabel} expense of ${formatInr(expense.amount)} on ${formatDate(expense.expenseDate)}.`,
          );
          this.reloads.next();
        },
        error: (error: unknown) => {
          this.deletePending.set(false);
          this.deleteError.set(describeApiError(error));
        },
      });
  }

  protected deleteMessage(expense: Expense): string {
    return `The ${expense.categoryLabel} expense of ${formatInr(expense.amount)} on ${formatDate(expense.expenseDate)} is deleted for good. This can’t be undone.`;
  }

  /** Account view: the selected account. Workspace view: a workspace-wide expense. */
  private addTarget(): ExpenseTarget | null {
    if (this.view().scope === 'account') {
      const account = this.account();
      return account
        ? { kind: 'account', accountId: account.id, label: account.displayName }
        : null;
    }
    const workspace = this.workspace();
    return workspace
      ? { kind: 'workspace', workspaceId: workspace.id, label: workspace.name }
      : null;
  }

  private navigate(view: ExpensesView): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: compactParams({
        scope: view.scope === 'account' ? null : view.scope,
        includeAccounts: view.scope === 'workspace' && view.includeAccounts,
        from: view.from,
        to: view.to,
        category: view.category,
        sort: view.sort === DEFAULT_EXPENSE_SORT ? null : view.sort,
        page: view.page === 1 ? null : view.page,
      }),
    });
  }

  private load(target: ListTarget, view: ExpensesView): Observable<ListState> {
    const key = JSON.stringify(target);
    const query: ExpenseListQuery = {
      page: view.page,
      pageSize: EXPENSE_PAGE_SIZE,
      sort: view.sort,
      from: view.from || undefined,
      to: view.to || undefined,
      category: view.category,
    };
    const request =
      target.kind === 'account'
        ? this.api.listForAccount(target.id, query)
        : this.api.listForWorkspace(target.id, {
            ...query,
            scope: target.includeAccounts ? 'all' : 'workspace',
          });
    return request.pipe(
      map((result): ListState => ({ kind: 'ready', key, result })),
      catchError((error: unknown) =>
        of<ListState>({ kind: 'error', key, message: describeApiError(error) }),
      ),
      startWith<ListState>({ kind: 'loading', key }),
    );
  }
}
