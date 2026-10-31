import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { ApiError, describeApiError, toApiError } from '../../core/api/api-error';
import {
  IMPORT_MAX_FILE_MB,
  ImportConfig,
  ImportDetail,
  fieldLabel,
} from '../../core/imports/import.models';
import { ImportsApiService } from '../../core/imports/imports-api.service';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { ValidationSummary } from '../../shared/validation-summary/validation-summary';
import { ImportActions } from './import-actions/import-actions';
import { ImportHistory } from './import-history/import-history';
import { ImportResult, importResultNotice } from './import-result/import-result';
import { ImportReview } from './import-review/import-review';
import { ImportStatusBadge } from './import-status-badge/import-status-badge';
import {
  ImportUploadForm,
  ImportUploadRequest,
} from './import-upload-form/import-upload-form';

interface UploadFailure {
  heading: string;
  message: string;
  error: ApiError;
}

/**
 * Imports for one seller account of the selected workspace (the account shared with the other
 * account-scoped pages, see `SelectedSellerAccountService`): upload a Meesho report, check the
 * preview (counts, planned changes, columns, sample rows, rows with errors), then confirm or
 * discard it; below, the account's import history. Members and owners can do all of it.
 */
@Component({
  selector: 'app-imports-page',
  imports: [
    SellerAccountPicker,
    ImportUploadForm,
    ImportReview,
    ImportActions,
    ImportResult,
    ImportHistory,
    ImportStatusBadge,
    ValidationSummary,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './imports-page.html',
})
export class ImportsPage {
  private readonly api = inject(ImportsApiService);
  private readonly selection = inject(SelectedSellerAccountService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private upload$: Subscription | null = null;

  private readonly uploadHeading = viewChild<ElementRef<HTMLElement>>('uploadHeading');
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>('previewHeading');
  private readonly uploadForm = viewChild(ImportUploadForm);
  private readonly uploadSummary = viewChild(ValidationSummary);
  private readonly resultPanel = viewChild(ImportResult);
  private readonly history = viewChild(ImportHistory);

  protected readonly selectedAccount = this.selection.selected;
  /** Name of the file being uploaded, while the request is in flight. */
  protected readonly uploading = signal<string | null>(null);
  protected readonly uploadFailure = signal<UploadFailure | null>(null);
  /** The import being reviewed: `previewed`, or `failed` / `importing` after a confirm. */
  protected readonly current = signal<ImportDetail | null>(null);
  /** The import that was just confirmed (`completed`). */
  protected readonly result = signal<ImportDetail | null>(null);
  /** Last outcome, announced politely. */
  protected readonly notice = signal('');
  protected readonly fieldLabel = fieldLabel;
  /** `GET /imports/config`; until it answers (or if it fails) the API's defaults apply. */
  protected readonly limits = signal<ImportConfig | null>(null);
  protected readonly maxFileMb = computed(() => this.limits()?.maxFileMb ?? IMPORT_MAX_FILE_MB);

  constructor() {
    this.api
      .config()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (config) => this.limits.set(config),
        // The server still enforces its limits (413 / 422); only the early check uses the default.
        error: () => undefined,
      });

    // Another workspace (its accounts are reloading) or account: start clean.
    effect(() => {
      this.selection.selectedId();
      untracked(() => this.resetInteractions());
    });
  }

  /** The user picked another account in the picker. */
  protected onAccountChange(): void {
    this.resetInteractions();
  }

  protected upload(request: ImportUploadRequest): void {
    const accountId = this.selection.selectedId();
    if (accountId === null || this.uploading() !== null) {
      return;
    }
    this.uploading.set(request.file.name);
    this.uploadFailure.set(null);
    this.notice.set('');
    this.result.set(null);
    this.current.set(null);
    this.upload$ = this.api
      .upload(accountId, request.file, request.dataAsOf)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => {
          this.uploading.set(null);
          this.current.set(job);
          this.uploadForm()?.reset();
          this.notice.set(
            `Uploaded ${job.originalFilename}. Check the preview, then confirm or discard it.`,
          );
          this.history()?.reload();
          this.focusAfterRender(() => this.previewHeading()?.nativeElement);
        },
        error: (error: unknown) => {
          this.uploading.set(null);
          this.uploadFailure.set(describeUploadFailure(toApiError(error), this.maxFileMb()));
          afterNextRender(() => this.uploadSummary()?.focus(), { injector: this.injector });
        },
      });
  }

  /** A confirm, retry or discard answered (see `ImportActions`). */
  protected onJobUpdated(job: ImportDetail): void {
    this.history()?.reload();
    switch (job.status) {
      case 'completed':
        this.current.set(null);
        this.result.set(job);
        this.notice.set(importResultNotice(job));
        afterNextRender(() => this.resultPanel()?.focus(), { injector: this.injector });
        break;
      case 'cancelled':
        this.current.set(null);
        this.notice.set(`Discarded the import of ${job.originalFilename}. Nothing was imported.`);
        this.focusAfterRender(() => this.uploadHeading()?.nativeElement);
        break;
      case 'failed':
        this.current.set(job);
        this.notice.set(`The import of ${job.originalFilename} failed. Nothing was imported.`);
        this.focusAfterRender(() => this.previewHeading()?.nativeElement);
        break;
      default:
        this.current.set(job);
    }
  }

  private focusAfterRender(target: () => HTMLElement | undefined): void {
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }

  /** Another workspace or account: drop the upload in flight, the preview and the messages. */
  private resetInteractions(): void {
    this.upload$?.unsubscribe();
    this.upload$ = null;
    this.uploading.set(null);
    this.uploadFailure.set(null);
    this.current.set(null);
    this.result.set(null);
    this.notice.set('');
  }
}

/**
 * Heading and text for a rejected upload: 422 unreadable file, 409 duplicate, 413 too large,
 * 429 server busy. A response without the API's envelope (e.g. from a proxy) gets a plain text.
 */
function describeUploadFailure(error: ApiError, maxFileMb: number): UploadFailure {
  const fromServer = error.code !== 'UNEXPECTED_RESPONSE';
  switch (error.status) {
    case 422:
      return { heading: 'The file could not be read', message: error.message, error };
    case 409:
      return { heading: 'This file cannot be uploaded', message: error.message, error };
    case 413:
      return {
        heading: 'The file is too large',
        message: fromServer ? error.message : `Files can be at most ${maxFileMb} MB.`,
        error,
      };
    case 429:
      return {
        heading: 'Imports are busy',
        message: fromServer ? error.message : 'Imports are busy, try again in a moment.',
        error,
      };
    default:
      return { heading: 'The upload failed', message: describeApiError(error), error };
  }
}
