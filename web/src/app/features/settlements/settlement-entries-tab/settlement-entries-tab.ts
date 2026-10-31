import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Subject, distinctUntilChanged, map, merge, switchMap } from 'rxjs';

import { describeApiError } from '../../../core/api/api-error';
import { ReconciliationApiService } from '../../../core/reconciliation/reconciliation-api.service';
import {
  DEFAULT_SETTLEMENT_SORT,
  MATCH_STATES,
  MatchState,
  SETTLEMENT_ENTRY_TYPES,
  SETTLEMENT_PAGE_SIZE,
  SETTLEMENT_SORTS,
  SettlementEntry,
  SettlementListResponse,
  SettlementSort,
  settlementEntryTypeLabel,
} from '../../../core/settlements/settlement.models';
import { SettlementsApiService } from '../../../core/settlements/settlements-api.service';
import { WorkspaceContextService } from '../../../core/workspaces/workspace-context.service';
import { Amount } from '../../../shared/amount/amount';
import { CheckboxGroup, CheckboxOption } from '../../../shared/checkbox-group/checkbox-group';
import { ConfirmDialog } from '../../../shared/confirm-dialog/confirm-dialog';
import { DateRange } from '../../../shared/date-range/date-range';
import { FilterBar } from '../../../shared/filter-bar/filter-bar';
import { plural } from '../../../shared/format/format';
import {
  Loadable,
  keepPreviousWhileLoading,
  toLoadable,
} from '../../../shared/loadable/loadable';
import { Pager } from '../../../shared/pager/pager';
import {
  isDateRangeValid,
  mergeParams,
  readDate,
  readList,
  readOneOf,
  readPage,
  readText,
} from '../../../shared/url-state/url-state';
import { SettlementEntriesTable } from '../settlement-entries-table/settlement-entries-table';

/** The entries list as the URL query describes it. */
export interface EntriesView {
  entryType: readonly string[];
  /** Payment date, `YYYY-MM-DD` or `''`. */
  from: string;
  to: string;
  match: MatchState | null;
  q: string;
  includeSuperseded: boolean;
  sort: SettlementSort;
  page: number;
}

/** Reads the entries view (`?entryType…&from&to&match&q&includeSuperseded&sort&page`). */
export function readEntriesView(params: ParamMap): EntriesView {
  let from = readDate(params, 'from');
  let to = readDate(params, 'to');
  if (!isDateRangeValid(from, to)) {
    from = '';
    to = '';
  }
  return {
    entryType: readList(params, 'entryType').filter((t) =>
      (SETTLEMENT_ENTRY_TYPES as readonly string[]).includes(t),
    ),
    from,
    to,
    match: readOneOf(params, 'match', MATCH_STATES),
    q: readText(params, 'q'),
    includeSuperseded: params.get('includeSuperseded') === 'true',
    sort: readOneOf(params, 'sort', SETTLEMENT_SORTS) ?? DEFAULT_SETTLEMENT_SORT,
    page: readPage(params),
  };
}

/**
 * The "Entries" tab: every settlement ledger entry of one account, filterable by entry type,
 * payment date, match state and text, sortable and paginated on the server, with every reported
 * amount and the as-reported total of all filtered entries. Owners can unmatch a matched entry.
 * The view lives in the URL query (merged with the page's `tab`).
 */
@Component({
  selector: 'app-settlement-entries-tab',
  imports: [
    RouterLink,
    Amount,
    CheckboxGroup,
    ConfirmDialog,
    DateRange,
    FilterBar,
    Pager,
    SettlementEntriesTable,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settlement-entries-tab.html',
})
export class SettlementEntriesTab {
  readonly accountId = input.required<string>();
  readonly accountName = input('');

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(SettlementsApiService);
  private readonly reconciliation = inject(ReconciliationApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new Subject<void>();
  private readonly dateRange = viewChild<string, ElementRef<HTMLElement>>('dateRange', {
    read: ElementRef,
  });

  protected readonly isOwner = inject(WorkspaceContextService).isOwner;
  protected readonly view = toSignal(this.route.queryParamMap.pipe(map(readEntriesView)), {
    requireSync: true,
  });
  protected readonly hasFilters = computed(() => {
    const v = this.view();
    return (
      v.entryType.length > 0 || v.from !== '' || v.to !== '' || !!v.match || v.q !== '' ||
      v.includeSuperseded
    );
  });
  protected readonly entryTypeOptions: CheckboxOption[] = SETTLEMENT_ENTRY_TYPES.map((t) => ({
    value: t,
    label: settlementEntryTypeLabel(t),
  }));

  protected readonly draftEntryType = linkedSignal<readonly string[]>(() => this.view().entryType);
  protected readonly draftFrom = linkedSignal(() => this.view().from);
  protected readonly draftTo = linkedSignal(() => this.view().to);
  protected readonly draftMatch = linkedSignal<string>(() => this.view().match ?? '');
  protected readonly draftQ = linkedSignal(() => this.view().q);
  protected readonly draftSuperseded = linkedSignal(() => this.view().includeSuperseded);

  protected readonly state = signal<Loadable<SettlementListResponse>>({ kind: 'loading' });
  protected readonly notice = signal('');
  /** The entry waiting for an unmatch confirmation. */
  protected readonly unmatchTarget = signal<SettlementEntry | null>(null);
  protected readonly unmatchPending = signal(false);
  protected readonly unmatchError = signal<string | null>(null);
  protected readonly plural = plural;

  constructor() {
    const request = computed(() => ({ accountId: this.accountId(), view: this.view() }));
    merge(
      // A URL change that leaves this view as it was (e.g. `tab`) sends no new request.
      toObservable(request).pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
      this.reloads.pipe(map(() => request())),
    )
      .pipe(
        switchMap(({ accountId, view }) =>
          toLoadable(
            this.api.list(accountId, {
              page: view.page,
              pageSize: SETTLEMENT_PAGE_SIZE,
              sort: view.sort,
              entryType: view.entryType,
              from: view.from || undefined,
              to: view.to || undefined,
              q: view.q || undefined,
              match: view.match ?? undefined,
              includeSuperseded: view.includeSuperseded,
            }),
          ),
        ),
        keepPreviousWhileLoading(),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected applyFilters(): void {
    if (!isDateRangeValid(this.draftFrom(), this.draftTo())) {
      this.dateRange()?.nativeElement.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    const match = this.draftMatch();
    this.navigate({
      entryType: this.draftEntryType(),
      from: this.draftFrom(),
      to: this.draftTo(),
      match: (MATCH_STATES as readonly string[]).includes(match) ? (match as MatchState) : null,
      q: this.draftQ().trim(),
      includeSuperseded: this.draftSuperseded(),
      sort: this.view().sort,
      page: 1,
    });
  }

  protected clearFilters(): void {
    this.navigate({
      entryType: [],
      from: '',
      to: '',
      match: null,
      q: '',
      includeSuperseded: false,
      sort: this.view().sort,
      page: 1,
    });
  }

  protected changeSort(sort: string): void {
    if ((SETTLEMENT_SORTS as readonly string[]).includes(sort)) {
      this.navigate({ ...this.view(), sort: sort as SettlementSort, page: 1 });
    }
  }

  protected changePage(page: number): void {
    this.navigate({ ...this.view(), page });
  }

  protected retry(): void {
    this.reloads.next();
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected askUnmatch(entry: SettlementEntry): void {
    if (!this.isOwner()) {
      return;
    }
    this.unmatchError.set(null);
    this.unmatchTarget.set(entry);
  }

  protected cancelUnmatch(): void {
    if (!this.unmatchPending()) {
      this.unmatchTarget.set(null);
      this.unmatchError.set(null);
    }
  }

  protected confirmUnmatch(): void {
    const entry = this.unmatchTarget();
    if (entry === null || this.unmatchPending()) {
      return;
    }
    this.unmatchPending.set(true);
    this.unmatchError.set(null);
    this.reconciliation
      .manualUnmatch(this.accountId(), { settlementEntryId: entry.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.unmatchPending.set(false);
          this.unmatchTarget.set(null);
          this.notice.set(
            `Unmatched entry ${entryName(entry)} from order ${entry.match.orderSubOrderNo ?? entry.match.orderId ?? ''}. Automatic matching will skip it until it is matched by hand.`,
          );
          this.reloads.next();
        },
        error: (error: unknown) => {
          this.unmatchPending.set(false);
          this.unmatchError.set(describeApiError(error));
        },
      });
  }

  protected unmatchMessage(entry: SettlementEntry): string {
    const order = entry.match.orderSubOrderNo ?? entry.match.orderId ?? 'its order';
    return `Entry ${entryName(entry)} will no longer be linked to order ${order}. Automatic matching will skip it until an owner matches it by hand.`;
  }

  private navigate(view: EntriesView): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: mergeParams({
        entryType: view.entryType,
        from: view.from,
        to: view.to,
        match: view.match,
        q: view.q,
        includeSuperseded: view.includeSuperseded,
        sort: view.sort === DEFAULT_SETTLEMENT_SORT ? null : view.sort,
        page: view.page === 1 ? null : view.page,
      }),
      queryParamsHandling: 'merge',
    });
  }
}

function entryName(entry: SettlementEntry): string {
  return entry.transactionId ?? entry.subOrderNo ?? entry.id;
}
