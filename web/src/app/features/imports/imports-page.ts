import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  map,
  merge,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ApiError, describeApiError, toApiError } from '../../core/api/api-error';
import {
  IMPORT_MAX_FILE_MB,
  ImportConfig,
  ImportDetail,
  fieldLabel,
} from '../../core/imports/import.models';
import { ImportsApiService } from '../../core/imports/imports-api.service';
import { SellerAccount } from '../../core/seller-accounts/seller-account.models';
import { SellerAccountsApiService } from '../../core/seller-accounts/seller-accounts-api.service';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
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

/** localStorage key prefix for the last seller account picked on this page, per workspace. */
export const IMPORT_ACCOUNT_STORAGE_PREFIX = 'msaas.imports.accountId.';

type AccountsState =
  | { kind: 'loading' }
  | { kind: 'no-workspace' }
  | { kind: 'error'; message: string }
  /** `accounts`: the active ones only, sorted by name. */
  | { kind: 'ready'; workspaceId: string; accounts: SellerAccount[] };

interface UploadFailure {
  heading: string;
  message: string;
  error: ApiError;
}

/**
 * Imports for one seller account of the selected workspace: upload a Meesho report, check the
 * preview (counts, planned changes, columns, sample rows, rows with errors), then confirm or
 * discard it; below, the account's import history. Members and owners can do all of it.
 */
@Component({
  selector: 'app-imports-page',
  imports: [
    RouterLink,
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
  private readonly accountsApi = inject(SellerAccountsApiService);
  private readonly context = inject(WorkspaceContextService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reloads = new Subject<void>();
  private upload$: Subscription | null = null;

  private readonly uploadHeading = viewChild<ElementRef<HTMLElement>>('uploadHeading');
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>('previewHeading');
  private readonly uploadForm = viewChild(ImportUploadForm);
  private readonly uploadSummary = viewChild(ValidationSummary);
  private readonly resultPanel = viewChild(ImportResult);
  private readonly history = viewChild(ImportHistory);

  protected readonly isOwner = this.context.isOwner;
  protected readonly accounts = signal<AccountsState>({ kind: 'loading' });
  protected readonly selectedAccountId = signal<string | null>(null);
  protected readonly selectedAccount = computed(() => {
    const state = this.accounts();
    const id = this.selectedAccountId();
    return state.kind === 'ready' ? (state.accounts.find((a) => a.id === id) ?? null) : null;
  });
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

    merge(
      toObservable(this.context.selectedId),
      this.reloads.pipe(map(() => this.context.selectedId())),
    )
      .pipe(
        tap(() => {
          this.selectedAccountId.set(null);
          this.resetInteractions();
        }),
        switchMap((workspaceId) => this.loadAccounts(workspaceId)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.accounts.set(state);
        if (state.kind === 'ready') {
          this.selectedAccountId.set(pickAccount(state.workspaceId, state.accounts));
        }
      });
  }

  protected retryAccounts(): void {
    this.reloads.next();
  }

  protected selectAccount(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const state = this.accounts();
    if (state.kind !== 'ready' || !state.accounts.some((a) => a.id === id)) {
      return;
    }
    if (id === this.selectedAccountId()) {
      return;
    }
    this.resetInteractions();
    this.selectedAccountId.set(id);
    rememberAccount(state.workspaceId, id);
  }

  protected upload(request: ImportUploadRequest): void {
    const accountId = this.selectedAccountId();
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

  private loadAccounts(workspaceId: string | null): Observable<AccountsState> {
    if (workspaceId === null) {
      return of<AccountsState>({ kind: 'no-workspace' });
    }
    return this.accountsApi.list(workspaceId).pipe(
      map(
        (accounts): AccountsState => ({
          kind: 'ready',
          workspaceId,
          accounts: accounts
            .filter((a) => a.status === 'active')
            .sort((a, b) =>
              a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
            ),
        }),
      ),
      catchError((error: unknown) =>
        of<AccountsState>({ kind: 'error', message: describeApiError(error) }),
      ),
      startWith<AccountsState>({ kind: 'loading' }),
    );
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

/** The remembered account when it is still active in this workspace, else the first one. */
function pickAccount(workspaceId: string, accounts: SellerAccount[]): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(IMPORT_ACCOUNT_STORAGE_PREFIX + workspaceId);
  } catch {
    // Storage unavailable: fall back to the first account.
  }
  return accounts.find((a) => a.id === stored)?.id ?? accounts[0]?.id ?? null;
}

function rememberAccount(workspaceId: string, accountId: string): void {
  try {
    localStorage.setItem(IMPORT_ACCOUNT_STORAGE_PREFIX + workspaceId, accountId);
  } catch {
    // Not remembered; the choice still applies on this page.
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
