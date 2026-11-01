import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap } from 'rxjs';

import { describeApiError } from '../../../core/api/api-error';
import {
  IMPORT_PAGE_SIZE,
  ImportSummary,
  PagedResponse,
  reportTypeLabel,
} from '../../../core/imports/import.models';
import { ImportsApiService } from '../../../core/imports/imports-api.service';
import { MISSING } from '../../../shared/format/format';
import { CountPipe, DisplayDateTimePipe, FileSizePipe } from '../../../shared/format/format.pipes';
import { Pager } from '../../../shared/pager/pager';
import { ImportStatusBadge } from '../import-status-badge/import-status-badge';
import { LoadingState } from '../../../shared/loading-state/loading-state';
import { ErrorState } from '../../../shared/error-state/error-state';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { TableRegion } from '../../../shared/table-region/table-region';

type HistoryState =
  | { kind: 'loading'; accountId: string }
  | { kind: 'ready'; accountId: string; result: PagedResponse<ImportSummary> }
  | { kind: 'error'; message: string };

/**
 * The imports of one seller account, newest first, paginated on the server. Each file links to
 * its detail page. Call {@link reload} after an upload, confirm or discard.
 */
@Component({
  selector: 'app-import-history',
  imports: [
    RouterLink,
    CountPipe,
    DisplayDateTimePipe,
    FileSizePipe,
    ImportStatusBadge,
    Pager,
    LoadingState,
    ErrorState,
    EmptyState,
    TableRegion,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './import-history.html',
})
export class ImportHistory {
  readonly accountId = input.required<string>();
  /** For the table caption. */
  readonly accountName = input('');
  readonly pageSize = input(IMPORT_PAGE_SIZE);

  private readonly api = inject(ImportsApiService);
  private readonly reloads = new Subject<void>();

  protected readonly missing = MISSING;
  protected readonly reportTypeLabel = reportTypeLabel;
  /** Back to page 1 whenever another account is shown. */
  protected readonly page = linkedSignal({ source: this.accountId, computation: () => 1 });
  protected readonly state = signal<HistoryState>({ kind: 'loading', accountId: '' });
  /** True while another page of the same account loads; the current page stays on screen. */
  protected readonly busy = signal(false);

  constructor() {
    const params = computed(() => ({
      accountId: this.accountId(),
      page: this.page(),
      pageSize: this.pageSize(),
    }));
    merge(toObservable(params), this.reloads.pipe(map(() => params())))
      .pipe(
        switchMap((p) => this.load(p.accountId, p.page, p.pageSize)),
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

  /** Shows the first page (where a new import appears) again, fresh from the API. */
  reload(): void {
    if (this.page() !== 1) {
      this.page.set(1);
    } else {
      this.reloads.next();
    }
  }

  /** "Try again" after an error: the same page. */
  protected retry(): void {
    this.reloads.next();
  }

  protected uploaderName(item: ImportSummary): string {
    return item.createdBy ? (item.createdBy.displayName ?? item.createdBy.email) : MISSING;
  }

  private load(accountId: string, page: number, pageSize: number): Observable<HistoryState> {
    return this.api.list(accountId, { page, pageSize }).pipe(
      map((result): HistoryState => ({ kind: 'ready', accountId, result })),
      catchError((error: unknown) =>
        of<HistoryState>({ kind: 'error', message: describeApiError(error) }),
      ),
      startWith<HistoryState>({ kind: 'loading', accountId }),
    );
  }
}
