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
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap } from 'rxjs';

import { describeApiError } from '../../../core/api/api-error';
import {
  IMPORT_PAGE_SIZE,
  ImportRow,
  PagedResponse,
  fieldLabel,
} from '../../../core/imports/import.models';
import { ImportsApiService } from '../../../core/imports/imports-api.service';
import { Pager } from '../../../shared/pager/pager';

type ErrorsState =
  | { kind: 'none' }
  | { kind: 'loading'; importId: string }
  | { kind: 'ready'; importId: string; result: PagedResponse<ImportRow> }
  | { kind: 'error'; message: string };

interface ErrorLine {
  key: string;
  rowNumber: number;
  sheetName: string | null;
  field: string;
  reason: string;
}

/**
 * The rows with errors of one import (`GET /imports/:id/errors`), one line per problem, paginated
 * on the server. Nothing is requested when the import has no rows with errors.
 */
@Component({
  selector: 'app-import-errors-table',
  imports: [Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let state = view();
    <div [attr.aria-busy]="state.kind === 'loading' || busy()" [attr.data-state]="state.kind">
      @if (state.kind === 'none') {
        <p class="text-sm text-slate-700">No rows have errors.</p>
      } @else if (state.kind === 'loading') {
        <p role="status" class="text-sm text-slate-700">Loading the rows with errors…</p>
      } @else if (state.kind === 'error') {
        <div role="alert" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm">
          <p class="font-medium text-red-800">The rows with errors could not be loaded.</p>
          <p class="mt-1 text-red-800">{{ state.message }}</p>
          <button
            type="button"
            class="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            (click)="reload()"
          >
            Try again
          </button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <caption class="sr-only">
              Rows with errors
            </caption>
            <thead class="bg-slate-50">
              <tr>
                <th scope="col" class="px-4 py-2.5 text-left font-semibold text-slate-700">Row</th>
                <th scope="col" class="px-4 py-2.5 text-left font-semibold text-slate-700">
                  Sheet
                </th>
                <th scope="col" class="px-4 py-2.5 text-left font-semibold text-slate-700">
                  Field
                </th>
                <th scope="col" class="px-4 py-2.5 text-left font-semibold text-slate-700">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              @for (line of lines(); track line.key) {
                <tr [attr.data-row-number]="line.rowNumber">
                  <th
                    scope="row"
                    class="px-4 py-2.5 text-left align-top font-medium text-slate-900 tabular-nums"
                  >
                    {{ line.rowNumber }}
                  </th>
                  <td class="px-4 py-2.5 align-top text-slate-700">
                    @if (line.sheetName) {
                      {{ line.sheetName }}
                    } @else {
                      <span aria-hidden="true">—</span><span class="sr-only">None</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 align-top text-slate-700">{{ line.field }}</td>
                  <td class="px-4 py-2.5 align-top text-slate-900">{{ line.reason }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-pager
          class="mt-3"
          [page]="state.result.page"
          [pageSize]="state.result.pageSize"
          [total]="state.result.total"
          label="Pages of rows with errors"
          itemLabel="rows with errors"
          [busy]="busy()"
          (pageChange)="page.set($event)"
        />
      }
    </div>
  `,
})
export class ImportErrorsTable {
  readonly importId = input.required<string>();
  /** The job's `errorRows`; `0` skips the request. `null` (not known) still asks the API. */
  readonly errorRows = input<number | null>(null);
  readonly pageSize = input(IMPORT_PAGE_SIZE);

  private readonly api = inject(ImportsApiService);
  private readonly reloads = new Subject<void>();

  /** Back to page 1 whenever another import is shown. */
  protected readonly page = linkedSignal({ source: this.importId, computation: () => 1 });
  private readonly loaded = signal<ErrorsState>({ kind: 'loading', importId: '' });
  /** True while another page of the same import loads; the current page stays on screen. */
  protected readonly busy = signal(false);
  protected readonly view = computed<ErrorsState>(() =>
    this.errorRows() === 0 ? { kind: 'none' } : this.loaded(),
  );
  protected readonly lines = computed<ErrorLine[]>(() => {
    const state = this.view();
    return state.kind === 'ready' ? toLines(state.result.items) : [];
  });

  constructor() {
    const params = computed(() => ({
      importId: this.importId(),
      errorRows: this.errorRows(),
      page: this.page(),
      pageSize: this.pageSize(),
    }));
    merge(toObservable(params), this.reloads.pipe(map(() => params())))
      .pipe(
        switchMap((p) => this.load(p.importId, p.errorRows, p.page, p.pageSize)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        const current = this.loaded();
        if (
          state.kind === 'loading' &&
          current.kind === 'ready' &&
          current.importId === state.importId
        ) {
          this.busy.set(true);
          return;
        }
        this.busy.set(false);
        this.loaded.set(state);
      });
  }

  protected reload(): void {
    this.reloads.next();
  }

  private load(
    importId: string,
    errorRows: number | null,
    page: number,
    pageSize: number,
  ): Observable<ErrorsState> {
    if (errorRows === 0) {
      return of<ErrorsState>({ kind: 'none' });
    }
    return this.api.errors(importId, { page, pageSize }).pipe(
      map(
        (result): ErrorsState =>
          result.total === 0 && result.items.length === 0
            ? { kind: 'none' }
            : { kind: 'ready', importId, result },
      ),
      catchError((error: unknown) =>
        of<ErrorsState>({ kind: 'error', message: describeApiError(error) }),
      ),
      startWith<ErrorsState>({ kind: 'loading', importId }),
    );
  }
}

function toLines(rows: ImportRow[]): ErrorLine[] {
  return rows.flatMap((row) => {
    const errors = row.errors.length > 0 ? row.errors : [{ field: '', reason: 'Invalid row.' }];
    return errors.map((error, index) => ({
      key: `${row.id}:${index}`,
      rowNumber: row.rowNumber,
      sheetName: row.sheetName,
      field: error.field ? fieldLabel(error.field) : '—',
      reason: error.reason,
    }));
  });
}
