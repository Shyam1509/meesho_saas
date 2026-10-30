import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { ApiError, describeApiError, toApiError } from '../../../core/api/api-error';
import { ImportDetail, fieldLabel } from '../../../core/imports/import.models';
import { ImportsApiService } from '../../../core/imports/imports-api.service';
import { ConfirmDialog } from '../../../shared/confirm-dialog/confirm-dialog';
import { plural } from '../../../shared/format/format';
import { ValidationSummary } from '../../../shared/validation-summary/validation-summary';

type Action = 'confirm' | 'retry' | 'cancel';

let nextId = 0;

/**
 * What can be done with an import: the buttons the server's `allowedActions` lists — Confirm,
 * Retry, Discard (after a confirmation dialog). A stale `importing` job may offer Retry / Discard. When rows have errors, Confirm needs the
 * "Skip the N rows with errors" box ticked and sends `skipErrorRows: true`. Emits the job as the
 * API returns it; a failed confirm or retry also re-reads the job, in case its status moved.
 */
@Component({
  selector: 'app-import-actions',
  imports: [ConfirmDialog, ValidationSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './import-actions.html',
})
export class ImportActions {
  readonly job = input.required<ImportDetail>();
  readonly updated = output<ImportDetail>();

  private readonly api = inject(ImportsApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly skipCheckbox = viewChild<ElementRef<HTMLInputElement>>('skipCheckbox');
  private readonly errorSummary = viewChild(ValidationSummary);

  protected readonly idPrefix = `import-actions-${++nextId}`;
  protected readonly fieldLabel = fieldLabel;

  /** Buttons come from the server's `allowedActions` only, never from the status. */
  private readonly allowed = computed(() => this.job().allowedActions ?? []);
  protected readonly canConfirm = computed(() => this.allowed().includes('confirm'));
  protected readonly canRetry = computed(() => this.allowed().includes('retry'));
  protected readonly canDiscard = computed(() => this.allowed().includes('cancel'));
  protected readonly hasActions = computed(
    () => this.canConfirm() || this.canRetry() || this.canDiscard(),
  );
  protected readonly errorRows = computed(() => this.job().errorRows ?? 0);
  protected readonly noValidRows = computed(() => this.job().validRows === 0);
  protected readonly skipLabel = computed(
    () => `Skip the ${plural(this.errorRows(), 'row')} with errors`,
  );
  protected readonly skipHint = computed(() => {
    const valid = this.job().validRows;
    const validText = valid === null ? 'valid rows' : plural(valid, 'valid row');
    return `Only the ${validText} ${valid === 1 ? 'is' : 'are'} imported. Fix the other rows and upload them again later.`;
  });

  /** Reset for each import shown (a new job id), but kept when the same job is refreshed. */
  protected readonly skipErrors = linkedSignal({ source: () => this.job().id, computation: () => false });
  protected readonly skipRequired = linkedSignal({
    source: () => this.job().id,
    computation: () => false,
  });
  protected readonly actionError = linkedSignal<string, { heading: string; error: ApiError } | null>({
    source: () => this.job().id,
    computation: () => null,
  });
  protected readonly pending = signal<Action | null>(null);
  protected readonly askingDiscard = signal(false);
  protected readonly discardError = signal<string | null>(null);

  protected toggleSkip(event: Event): void {
    this.skipErrors.set((event.target as HTMLInputElement).checked);
    if (this.skipErrors()) {
      this.skipRequired.set(false);
    }
  }

  protected confirm(): void {
    if (this.pending() !== null || !this.canConfirm()) {
      return;
    }
    const withErrors = this.errorRows() > 0;
    if (withErrors && !this.skipErrors()) {
      this.skipRequired.set(true);
      this.skipCheckbox()?.nativeElement.focus();
      return;
    }
    const job = this.job();
    this.run(
      'confirm',
      'The import could not be confirmed',
      this.api.confirm(job.id, withErrors ? { skipErrorRows: true } : {}),
    );
  }

  protected retry(): void {
    if (this.pending() === null && this.canRetry()) {
      this.run('retry', 'The import could not be retried', this.api.retry(this.job().id));
    }
  }

  protected askToDiscard(): void {
    if (this.pending() !== null) {
      return;
    }
    this.discardError.set(null);
    this.askingDiscard.set(true);
  }

  protected closeDiscard(): void {
    this.askingDiscard.set(false);
    this.discardError.set(null);
  }

  protected discard(): void {
    if (this.pending() !== null) {
      return;
    }
    this.pending.set('cancel');
    this.discardError.set(null);
    this.api
      .cancel(this.job().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => {
          this.pending.set(null);
          this.askingDiscard.set(false);
          this.updated.emit(job);
        },
        error: (error: unknown) => {
          this.pending.set(null);
          this.discardError.set(describeApiError(error));
        },
      });
  }

  protected skipErrorText(): string {
    return `Tick “${this.skipLabel()}” to import only the valid rows, or discard this import.`;
  }

  private run(action: Action, heading: string, request: Observable<ImportDetail>): void {
    const job = this.job();
    this.pending.set(action);
    this.actionError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.pending.set(null);
        this.updated.emit(result);
      },
      error: (error: unknown) => {
        this.pending.set(null);
        const apiError = toApiError(error);
        this.actionError.set({
          heading,
          error: new ApiError(
            apiError.status,
            apiError.code,
            describeApiError(apiError),
            apiError.requestId,
            apiError.details,
          ),
        });
        afterNextRender(() => this.errorSummary()?.focus(), { injector: this.injector });
        this.refresh(job);
      },
    });
  }

  /** After a failed action the job may have moved on (e.g. to `failed`); show its real status. */
  private refresh(job: ImportDetail): void {
    this.api
      .get(job.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fresh) => {
          if (fresh.status !== job.status) {
            this.updated.emit(fresh);
          }
        },
        error: () => undefined,
      });
  }
}
