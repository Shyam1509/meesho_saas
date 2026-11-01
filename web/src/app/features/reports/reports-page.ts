import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, Subscription, catchError, map, of, startWith, switchMap } from 'rxjs';

import { describeApiError, toApiError } from '../../core/api/api-error';
import { ExpensesApiService } from '../../core/expenses/expenses-api.service';
import { DOUBLE_COUNTING_NOTE } from '../../core/expenses/expense.models';
import { ORDER_SETTLEMENT_FILTERS, OrderSettlementFilter } from '../../core/orders/order.models';
import { OrdersApiService } from '../../core/orders/orders-api.service';
import {
  CsvFile,
  EXPENSE_EXPORT_COLUMNS,
  MAX_EXPORT_ROWS,
  ORDER_EXPORT_COLUMNS,
  SETTLEMENT_EXPORT_COLUMNS,
} from '../../core/reports/report.models';
import { FileSaverService } from '../../core/reports/file-saver.service';
import { ReportsApiService } from '../../core/reports/reports-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import {
  AS_REPORTED_NOTE,
  MATCH_STATES,
  MatchState,
  SETTLEMENT_ENTRY_TYPES,
  SettlementDateBasis,
  settlementEntryTypeLabel,
} from '../../core/settlements/settlement.models';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { CheckboxGroup, CheckboxOption } from '../../shared/checkbox-group/checkbox-group';
import { DateRange } from '../../shared/date-range/date-range';
import { formatCount } from '../../shared/format/format';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { isDateRangeValid } from '../../shared/url-state/url-state';
import { DownloadState, ExportCard } from './export-card/export-card';

type ExportKind = 'orders' | 'settlements' | 'expenses';

/** Whose expenses the expenses export holds. */
export type ExpensesExportScope = 'account' | 'workspace' | 'all';

type OptionsState =
  | { kind: 'loading' }
  | { kind: 'ready'; options: CheckboxOption[] }
  | { kind: 'error' };

const IDLE: DownloadState = { kind: 'idle' };

/**
 * `/reports`: CSV exports of the orders, settlement entries and expenses, each with its own
 * filters (the same ones as its list) and column list. The orders and settlements exports are of
 * the shared selected seller account; the expenses export can also be workspace-wide.
 *
 * Downloads are fetched as a Blob and then saved, rather than opened as a plain
 * `<a href download>`: the API refuses an export of more than 100 000 rows with a 422 and a JSON
 * message, and only a fetched response lets the page show that message (and 400/404 errors)
 * next to the filters instead of the browser saving or opening an error body. The cost is that the
 * file is held in memory before it is saved, which the row limit keeps bounded.
 */
@Component({
  selector: 'app-reports-page',
  imports: [SellerAccountPicker, ExportCard, DateRange, CheckboxGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports-page.html',
})
export class ReportsPage {
  private readonly api = inject(ReportsApiService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly expensesApi = inject(ExpensesApiService);
  private readonly saver = inject(FileSaverService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly context = inject(WorkspaceContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ordersRange = viewChild<string, ElementRef<HTMLElement>>('ordersRange', {
    read: ElementRef,
  });
  private readonly settlementsRange = viewChild<string, ElementRef<HTMLElement>>(
    'settlementsRange',
    { read: ElementRef },
  );
  private readonly expensesRange = viewChild<string, ElementRef<HTMLElement>>('expensesRange', {
    read: ElementRef,
  });

  protected readonly maxRows = formatCount(MAX_EXPORT_ROWS);
  protected readonly asReportedNote = AS_REPORTED_NOTE;
  protected readonly doubleCountingNote = DOUBLE_COUNTING_NOTE;
  protected readonly orderColumns = ORDER_EXPORT_COLUMNS;
  protected readonly settlementColumns = SETTLEMENT_EXPORT_COLUMNS;
  protected readonly expenseColumns = EXPENSE_EXPORT_COLUMNS;
  protected readonly account = this.selection.selected;
  protected readonly workspace = this.context.selected;
  protected readonly entryTypeOptions: CheckboxOption[] = SETTLEMENT_ENTRY_TYPES.map((t) => ({
    value: t,
    label: settlementEntryTypeLabel(t),
  }));

  // Orders export.
  protected readonly ordersBasis = signal<'order_date' | 'payment_date'>('order_date');
  protected readonly ordersFrom = signal('');
  protected readonly ordersTo = signal('');
  protected readonly ordersStatus = signal<readonly string[]>([]);
  protected readonly ordersSettlement = signal<OrderSettlementFilter | ''>('');
  // Settlements export.
  protected readonly settlementsBasis = signal<SettlementDateBasis>('payment_date');
  protected readonly settlementsFrom = signal('');
  protected readonly settlementsTo = signal('');
  protected readonly settlementsTypes = signal<readonly string[]>([]);
  protected readonly settlementsMatch = signal<MatchState | ''>('');
  protected readonly settlementsSuperseded = signal(false);
  // Expenses export.
  protected readonly expensesScope = signal<ExpensesExportScope>('account');
  protected readonly expensesFrom = signal('');
  protected readonly expensesTo = signal('');
  protected readonly expensesCategories = signal<readonly string[]>([]);

  // The last download of each export; another seller account starts over.
  protected readonly ordersDownload = linkedSignal<string | null, DownloadState>({
    source: this.selection.selectedId,
    computation: () => IDLE,
  });
  protected readonly settlementsDownload = linkedSignal<string | null, DownloadState>({
    source: this.selection.selectedId,
    computation: () => IDLE,
  });
  protected readonly expensesDownload = linkedSignal<string | null, DownloadState>({
    source: this.selection.selectedId,
    computation: () => IDLE,
  });

  protected readonly statuses = signal<OptionsState>({ kind: 'loading' });
  protected readonly categories = signal<OptionsState>({ kind: 'loading' });
  protected readonly statusEmptyText = computed(() => emptyText(this.statuses(), 'No orders imported yet.'));
  protected readonly categoryEmptyText = computed(() =>
    emptyText(this.categories(), 'No categories.'),
  );
  /** Downloads in flight; aborted when what they were for changes. */
  private readonly inFlight = new Map<ExportKind, Subscription>();

  /** The expenses export needs an account unless it is workspace-wide. */
  protected readonly expensesNeedAccount = computed(() => this.expensesScope() === 'account');

  constructor() {
    // Another seller account (or workspace): abort its downloads; their states start over.
    effect(() => {
      this.selection.selectedId();
      untracked(() => {
        for (const kind of [...this.inFlight.keys()]) {
          this.cancel(kind);
        }
      });
    });

    toObservable(this.selection.selectedId)
      .pipe(
        switchMap((accountId) =>
          accountId === null ? of<OptionsState>({ kind: 'loading' }) : this.loadStatuses(accountId),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.statuses.set(state));

    this.expensesApi
      .categories()
      .pipe(
        map(
          (body): OptionsState => ({
            kind: 'ready',
            options: body.items.map((c) => ({ value: c.key, label: c.label })),
          }),
        ),
        catchError(() => of<OptionsState>({ kind: 'error' })),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.categories.set(state));
  }

  protected options(state: OptionsState): CheckboxOption[] {
    return state.kind === 'ready' ? state.options : [];
  }

  protected downloadOrders(): void {
    const accountId = this.selection.selectedId();
    if (accountId === null) {
      return;
    }
    if (!isDateRangeValid(this.ordersFrom(), this.ordersTo())) {
      focusFirstInput(this.ordersRange());
      return;
    }
    const byOrderDate = this.ordersBasis() === 'order_date';
    const settlement = this.ordersSettlement();
    this.run(
      this.api.ordersCsv(accountId, {
        status: this.ordersStatus(),
        from: byOrderDate ? this.ordersFrom() : undefined,
        to: byOrderDate ? this.ordersTo() : undefined,
        paymentFrom: byOrderDate ? undefined : this.ordersFrom(),
        paymentTo: byOrderDate ? undefined : this.ordersTo(),
        settlement: settlement === '' ? undefined : settlement,
      }),
      'orders',
      this.ordersDownload,
    );
  }

  protected downloadSettlements(): void {
    const accountId = this.selection.selectedId();
    if (accountId === null) {
      return;
    }
    if (!isDateRangeValid(this.settlementsFrom(), this.settlementsTo())) {
      focusFirstInput(this.settlementsRange());
      return;
    }
    const match = this.settlementsMatch();
    this.run(
      this.api.settlementsCsv(accountId, {
        entryType: this.settlementsTypes(),
        from: this.settlementsFrom(),
        to: this.settlementsTo(),
        dateBasis: this.settlementsBasis() === 'order_date' ? 'order_date' : undefined,
        match: match === '' ? undefined : match,
        includeSuperseded: this.settlementsSuperseded(),
      }),
      'settlements',
      this.settlementsDownload,
    );
  }

  protected downloadExpenses(): void {
    if (!isDateRangeValid(this.expensesFrom(), this.expensesTo())) {
      focusFirstInput(this.expensesRange());
      return;
    }
    const query = {
      from: this.expensesFrom(),
      to: this.expensesTo(),
      category: this.expensesCategories(),
    };
    const scope = this.expensesScope();
    if (scope === 'account') {
      const accountId = this.selection.selectedId();
      if (accountId !== null) {
        this.run(this.api.accountExpensesCsv(accountId, query), 'expenses', this.expensesDownload);
      }
      return;
    }
    const workspaceId = this.context.selectedId();
    if (workspaceId !== null) {
      this.run(
        this.api.workspaceExpensesCsv(workspaceId, {
          ...query,
          scope: scope === 'all' ? 'all' : 'workspace',
        }),
        'expenses',
        this.expensesDownload,
      );
    }
  }

  protected setOrdersBasis(event: Event): void {
    this.ordersBasis.set(valueOf(event) === 'payment_date' ? 'payment_date' : 'order_date');
  }

  protected setOrdersSettlement(event: Event): void {
    const value = valueOf(event);
    this.ordersSettlement.set(
      (ORDER_SETTLEMENT_FILTERS as readonly string[]).includes(value)
        ? (value as OrderSettlementFilter)
        : '',
    );
  }

  protected setSettlementsBasis(event: Event): void {
    this.settlementsBasis.set(valueOf(event) === 'order_date' ? 'order_date' : 'payment_date');
  }

  protected setSettlementsMatch(event: Event): void {
    const value = valueOf(event);
    this.settlementsMatch.set(
      (MATCH_STATES as readonly string[]).includes(value) ? (value as MatchState) : '',
    );
  }

  protected setSettlementsSuperseded(event: Event): void {
    this.settlementsSuperseded.set((event.target as HTMLInputElement).checked);
  }

  protected setExpensesScope(event: Event): void {
    const value = valueOf(event);
    const scope: ExpensesExportScope = value === 'workspace' || value === 'all' ? value : 'account';
    if (scope !== this.expensesScope()) {
      // A download for the other scope would be the wrong file: abort it.
      this.cancel('expenses');
      this.expensesDownload.set(IDLE);
      this.expensesScope.set(scope);
    }
  }

  private run(
    request: Observable<CsvFile>,
    kind: ExportKind,
    state: { set(value: DownloadState): void },
  ): void {
    this.cancel(kind);
    state.set({ kind: 'busy' });
    const subscription = request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (file) => {
        this.inFlight.delete(kind);
        this.saver.save(file.blob, file.filename);
        state.set({ kind: 'done', filename: file.filename });
      },
      error: (error: unknown) => {
        this.inFlight.delete(kind);
        const apiError = toApiError(error);
        state.set({ kind: 'error', status: apiError.status, message: describeApiError(apiError) });
      },
    });
    if (!subscription.closed) {
      this.inFlight.set(kind, subscription);
    }
  }

  /** Aborts the export's download in flight (the HTTP request is cancelled). */
  private cancel(kind: ExportKind): void {
    this.inFlight.get(kind)?.unsubscribe();
    this.inFlight.delete(kind);
  }

  private loadStatuses(accountId: string): Observable<OptionsState> {
    return this.ordersApi.statuses(accountId).pipe(
      map(
        (body): OptionsState => ({
          kind: 'ready',
          options: body.items.map((s) => ({
            value: s.status,
            label: `${s.status} (${formatCount(s.count)})`,
          })),
        }),
      ),
      catchError(() => of<OptionsState>({ kind: 'error' })),
      startWith<OptionsState>({ kind: 'loading' }),
    );
  }
}

function emptyText(state: OptionsState, none: string): string {
  switch (state.kind) {
    case 'loading':
      return 'Loading…';
    case 'error':
      return 'The choices could not be loaded.';
    default:
      return none;
  }
}

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function focusFirstInput(container: ElementRef<HTMLElement> | undefined): void {
  container?.nativeElement.querySelector<HTMLElement>('input')?.focus();
}
