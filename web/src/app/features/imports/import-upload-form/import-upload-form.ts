import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';

import { IMPORT_FILE_EXTENSIONS, IMPORT_MAX_FILE_MB } from '../../../core/imports/import.models';
import { FileDropZone } from '../../../shared/file-drop-zone/file-drop-zone';
import {
  dateStringInTimeZone,
  formatCount,
  localDateString,
} from '../../../shared/format/format';
import { errorMessage, requiredTrimmed, showError } from '../../../shared/forms/form-helpers';

/** What the form hands to the page to upload. */
export interface ImportUploadRequest {
  file: File;
  /**
   * The API's `dataAsOf` as a date-only `YYYY-MM-DD` (the server reads it as the end of that day in
   * India). Set for an orders CSV (where it is required), `null` for a workbook.
   */
  dataAsOf: string | null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The latest "Statuses as of" day allowed: today, both where the viewer is and in India (the API
 * rejects a day after today in IST), whichever is earlier.
 */
export function latestStatusDate(now: Date = new Date()): string {
  const local = localDateString(now);
  const india = dateStringInTimeZone(now, 'Asia/Kolkata');
  return india < local ? india : local;
}

/** A real `YYYY-MM-DD` calendar date, not after {@link latestStatusDate}. Blank passes. */
function statusDate(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (value.length === 0) {
    return null;
  }
  const match = DATE_PATTERN.exec(value);
  const parsed = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!match || !parsed || localDateString(parsed) !== value) {
    return { date: true };
  }
  return value > latestStatusDate() ? { future: true } : null;
}

let nextId = 0;

/**
 * Upload step: one `.csv` / `.xlsx` file (checked for type and size before anything is sent) and,
 * for an orders CSV only, the required "Statuses as of" day (when the report was downloaded).
 * Emits {@link submitted}; the page does the upload and calls {@link reset} once it succeeded.
 */
@Component({
  selector: 'app-import-upload-form',
  imports: [ReactiveFormsModule, FileDropZone],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      novalidate
      class="space-y-4"
      [attr.aria-busy]="pending()"
    >
      <app-file-drop-zone
        [inputId]="idPrefix + '-file'"
        label="Report file"
        [accept]="extensions"
        [maxBytes]="maxBytes()"
        [hint]="fileHint()"
        [disabled]="pending()"
        [error]="fileError()"
        [(file)]="file"
      />

      @if (isCsv()) {
        <div>
          <label [for]="idPrefix + '-data-as-of'" class="block text-sm font-medium text-slate-800">
            Statuses as of
          </label>
          <input
            [id]="idPrefix + '-data-as-of'"
            type="date"
            formControlName="dataAsOf"
            required
            [max]="today()"
            class="mt-1 block w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.dataAsOf) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.dataAsOf)
                ? idPrefix + '-data-as-of-hint ' + idPrefix + '-data-as-of-error'
                : idPrefix + '-data-as-of-hint'
            "
          />
          <p [id]="idPrefix + '-data-as-of-hint'" class="mt-1 text-xs text-slate-600">
            The day you downloaded this report from Meesho. Order statuses count as of the end of
            that day (India time).
          </p>
          @if (showError(form.controls.dataAsOf)) {
            <p [id]="idPrefix + '-data-as-of-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.dataAsOf, messages.dataAsOf) }}
            </p>
          }
        </div>
      }

      <button
        type="submit"
        class="rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white hover:bg-accent-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        [attr.aria-disabled]="pending() ? 'true' : null"
      >
        {{ pending() ? 'Uploading…' : 'Upload and preview' }}
      </button>
    </form>
  `,
})
export class ImportUploadForm {
  /** True while the page's upload request is in flight. */
  readonly pending = input(false);
  /** The server's limits (`GET /imports/config`); the size is checked before anything is sent. */
  readonly maxFileMb = input(IMPORT_MAX_FILE_MB);
  readonly maxRows = input<number | null>(null);
  readonly submitted = output<ImportUploadRequest>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly dropZone = viewChild.required(FileDropZone);

  protected readonly idPrefix = `import-upload-${++nextId}`;
  protected readonly extensions = IMPORT_FILE_EXTENSIONS;
  protected readonly maxBytes = computed(() => this.maxFileMb() * 1024 * 1024);
  protected readonly fileHint = computed(() => {
    const rows = this.maxRows();
    const limits =
      rows === null
        ? `${this.maxFileMb()} MB`
        : `${this.maxFileMb()} MB and ${formatCount(rows)} rows`;
    return `Meesho orders report (.csv) or settlement workbook (.xlsx), up to ${limits}.`;
  });
  protected readonly form = inject(NonNullableFormBuilder).group({
    // Required for a CSV; a workbook has no date and ignores this control.
    dataAsOf: ['', [requiredTrimmed, statusDate]],
  });
  protected readonly messages = {
    dataAsOf: {
      required: 'Enter the day you downloaded this report from Meesho.',
      date: 'Enter a valid date.',
      future: 'The date cannot be in the future.',
    },
  } as const;
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly isCsv = computed(
    () => this.file()?.name.toLowerCase().endsWith('.csv') ?? false,
  );
  protected readonly today = signal(latestStatusDate());

  constructor() {
    // Choosing (or removing) a file clears the "choose a file" message.
    effect(() => {
      this.file();
      untracked(() => this.fileError.set(null));
    });
  }

  /** Back to an empty form, e.g. after a successful upload. */
  reset(): void {
    this.dropZone().clear();
    this.form.reset({ dataAsOf: '' });
    this.fileError.set(null);
  }

  protected submit(): void {
    if (this.pending()) {
      return;
    }
    this.today.set(latestStatusDate());
    this.form.controls.dataAsOf.updateValueAndValidity();
    const file = this.file();
    if (file === null) {
      this.fileError.set('Choose a .csv or .xlsx file to upload.');
      this.dropZone().focus();
      return;
    }
    const csv = this.isCsv();
    const dateControl = this.form.controls.dataAsOf;
    if (csv && dateControl.invalid) {
      dateControl.markAsTouched();
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('[formcontrolname="dataAsOf"]')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.submitted.emit({ file, dataAsOf: csv ? dateControl.value.trim() : null });
  }
}
