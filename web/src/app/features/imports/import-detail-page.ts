import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap, tap } from 'rxjs';

import { describeApiError, toApiError } from '../../core/api/api-error';
import { ImportDetail, reportTypeLabel } from '../../core/imports/import.models';
import { ImportsApiService } from '../../core/imports/imports-api.service';
import { ImportActions } from './import-actions/import-actions';
import { ImportResult, importResultNotice } from './import-result/import-result';
import { ImportReview } from './import-review/import-review';
import { ImportStatusBadge } from './import-status-badge/import-status-badge';

/** The API's id format (decimal BIGINT as a string). */
const IMPORT_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

type DetailState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; job: ImportDetail };

/**
 * `/imports/:importId`: one import's summary, preview and rows with errors, with the actions its
 * status allows (Confirm when previewed, Retry when failed, Discard when previewed or failed).
 */
@Component({
  selector: 'app-import-detail-page',
  imports: [RouterLink, ImportActions, ImportResult, ImportReview, ImportStatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-detail-page.html',
})
export class ImportDetailPage {
  /** From the route (`withComponentInputBinding()`). */
  readonly importId = input.required<string>();

  private readonly api = inject(ImportsApiService);
  private readonly injector = inject(Injector);
  private readonly reloads = new Subject<void>();
  private readonly pageHeading = viewChild.required<ElementRef<HTMLElement>>('pageHeading');
  private readonly resultPanel = viewChild(ImportResult);

  protected readonly state = signal<DetailState>({ kind: 'loading' });
  protected readonly notice = signal('');
  protected readonly reportTypeLabel = reportTypeLabel;
  protected readonly heading = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.job.originalFilename : 'Import details';
  });

  constructor() {
    merge(toObservable(this.importId), this.reloads.pipe(map(() => this.importId())))
      .pipe(
        tap(() => this.notice.set('')),
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected retryLoad(): void {
    this.reloads.next();
  }

  protected onJobUpdated(job: ImportDetail): void {
    this.state.set({ kind: 'ready', job });
    switch (job.status) {
      case 'completed':
        this.notice.set(importResultNotice(job));
        afterNextRender(() => this.resultPanel()?.focus(), { injector: this.injector });
        break;
      case 'cancelled':
        this.notice.set(`Discarded the import of ${job.originalFilename}. Nothing was imported.`);
        this.focusHeading();
        break;
      case 'failed':
        this.notice.set(`The import of ${job.originalFilename} failed. Nothing was imported.`);
        this.focusHeading();
        break;
      default:
        break;
    }
  }

  private focusHeading(): void {
    afterNextRender(() => this.pageHeading().nativeElement.focus(), { injector: this.injector });
  }

  /** A malformed id (`/imports/abc`) is not found without asking; so are the API's 400 and 404. */
  private load(importId: string): Observable<DetailState> {
    if (!IMPORT_ID_PATTERN.test(importId)) {
      return of<DetailState>({ kind: 'not-found' });
    }
    return this.api.get(importId).pipe(
      map((job): DetailState => ({ kind: 'ready', job })),
      catchError((error: unknown) => {
        const status = toApiError(error).status;
        return of<DetailState>(
          status === 404 || status === 400
            ? { kind: 'not-found' }
            : { kind: 'error', message: describeApiError(error) },
        );
      }),
      startWith<DetailState>({ kind: 'loading' }),
    );
  }
}
