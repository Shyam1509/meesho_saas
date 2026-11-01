import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import {
  BUSINESS_TIME_ZONE,
  COST_MAX_DAYS_AHEAD,
  COST_NOTE_MAX_LENGTH,
  CostEntry,
  UNIT_COST_LIMIT,
} from '../../../core/products/product.models';
import { ProductsApiService } from '../../../core/products/products-api.service';
import { DIALOG_ACTIONS_CLASS, Dialog } from '../../../shared/dialog/dialog';
import { dateStringInTimeZone, formatDate } from '../../../shared/format/format';
import {
  applyServerFieldErrors,
  dateOnly,
  decimalAmount,
  errorMessage,
  focusFirstInvalidControl,
  maxLengthTrimmed,
  notAfter,
  requiredTrimmed,
  showError,
} from '../../../shared/forms/form-helpers';

let nextId = 0;

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The latest effective date the API accepts: today (India time) + {@link COST_MAX_DAYS_AHEAD}. */
export function latestCostDate(now: Date = new Date()): string {
  return addDays(dateStringInTimeZone(now, BUSINESS_TIME_ZONE), COST_MAX_DAYS_AHEAD);
}

/**
 * "Add unit cost" dialog (owners only): the cost of one unit from an effective date. A 409 naming
 * `effectiveFrom` (a cost already starts on that date) shows under the date field; other errors
 * above the form.
 */
@Component({
  selector: 'app-cost-entry-dialog',
  imports: [ReactiveFormsModule, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <app-dialog [heading]="'Add unit cost for ' + sku()" [busy]="submitting()" (closed)="cancel()">
      <p class="text-sm text-slate-600">
        The cost applies to orders dated on or after the effective date, until the next cost starts.
        Orders before the first cost keep an unknown cost.
      </p>
      @if (serverError(); as message) {
        <div
          #errorAlert
          role="alert"
          tabindex="-1"
          class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {{ message }}
        </div>
      }
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="mt-4 flex flex-col gap-4"
        [attr.aria-busy]="submitting()"
      >
        <div>
          <label [for]="idPrefix + '-date'" class="block text-sm font-medium text-slate-800">
            Effective from
          </label>
          <input
            [id]="idPrefix + '-date'"
            type="date"
            formControlName="effectiveFrom"
            data-autofocus
            [max]="maxDate"
            class="mt-1 block rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.effectiveFrom) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.effectiveFrom)
                ? idPrefix + '-date-hint ' + idPrefix + '-date-error'
                : idPrefix + '-date-hint'
            "
          />
          <p [id]="idPrefix + '-date-hint'" class="mt-1 text-xs text-slate-600">
            The first order date this cost applies to. A planned change can start up to
            {{ maxDaysAhead }} days ahead.
          </p>
          @if (showError(form.controls.effectiveFrom)) {
            <p [id]="idPrefix + '-date-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.effectiveFrom, messages.effectiveFrom) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-cost'" class="block text-sm font-medium text-slate-800">
            Unit cost (₹)
          </label>
          <input
            [id]="idPrefix + '-cost'"
            type="text"
            inputmode="decimal"
            formControlName="unitCost"
            autocomplete="off"
            class="mt-1 block w-48 rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.unitCost) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.unitCost)
                ? idPrefix + '-cost-hint ' + idPrefix + '-cost-error'
                : idPrefix + '-cost-hint'
            "
          />
          <p [id]="idPrefix + '-cost-hint'" class="mt-1 text-xs text-slate-600">
            What one unit costs you, in rupees, up to 4 decimals (for example 249.5). 0 is allowed
            and means it really costs nothing.
          </p>
          @if (showError(form.controls.unitCost)) {
            <p [id]="idPrefix + '-cost-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.unitCost, messages.unitCost) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-note'" class="block text-sm font-medium text-slate-800">
            Note <span class="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            [id]="idPrefix + '-note'"
            type="text"
            formControlName="note"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.note) ? 'true' : null"
            [attr.aria-describedby]="showError(form.controls.note) ? idPrefix + '-note-error' : null"
          />
          @if (showError(form.controls.note)) {
            <p [id]="idPrefix + '-note-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.note, messages.note) }}
            </p>
          }
        </div>

        <div [class]="actionsClass">
          <button
            type="submit"
            class="rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white hover:bg-accent-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            [attr.aria-disabled]="submitting() ? 'true' : null"
          >
            {{ submitting() ? 'Saving…' : 'Save cost' }}
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            (click)="cancel()"
          >
            Cancel
          </button>
        </div>
      </form>
    </app-dialog>
  `,
})
export class CostEntryDialog {
  readonly productId = input.required<string>();
  readonly sku = input.required<string>();

  readonly saved = output<CostEntry>();
  readonly cancelled = output();

  private readonly api = inject(ProductsApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly idPrefix = `cost-entry-${++nextId}`;
  protected readonly actionsClass = DIALOG_ACTIONS_CLASS;
  protected readonly maxDaysAhead = COST_MAX_DAYS_AHEAD;
  protected readonly maxDate = latestCostDate();
  protected readonly form = inject(NonNullableFormBuilder).group({
    effectiveFrom: ['', [requiredTrimmed, dateOnly, notAfter(() => latestCostDate())]],
    unitCost: [
      '',
      [requiredTrimmed, decimalAmount({ maxDecimals: 4, limit: UNIT_COST_LIMIT })],
    ],
    note: ['', [maxLengthTrimmed(COST_NOTE_MAX_LENGTH)]],
  });
  protected readonly messages = {
    effectiveFrom: {
      required: 'Enter the date this cost applies from.',
      date: 'Enter a valid date.',
      after: `The date can be at most ${COST_MAX_DAYS_AHEAD} days ahead (latest ${formatDate(this.maxDate)}).`,
    },
    unitCost: {
      required: 'Enter the unit cost.',
      format: 'Enter rupees as a number with up to 4 decimals, for example 249.5 (no ₹ sign or commas).',
      limit: 'The unit cost must be less than ₹10,00,00,000.',
    },
    note: { maxlength: `Note must be at most ${COST_NOTE_MAX_LENGTH} characters.` },
  } as const;
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  protected submit(): void {
    if (this.submitting()) {
      return;
    }
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement, this.form);
      return;
    }
    const note = this.form.controls.note.value.trim();
    this.submitting.set(true);
    this.api
      .addCost(this.productId(), {
        effectiveFrom: this.form.controls.effectiveFrom.value.trim(),
        unitCost: this.form.controls.unitCost.value.trim(),
        ...(note ? { note } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entry) => {
          this.submitting.set(false);
          this.saved.emit(entry);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          const apiError = toApiError(error);
          // A same-date 409 names `effectiveFrom`; any other error (including a 409 without field
          // details, e.g. a disabled or busy account) is shown for the whole form.
          const fields = applyServerFieldErrors(this.form, apiError);
          if (fields.length === 0) {
            this.serverError.set(describeApiError(apiError));
          }
          afterNextRender(
            () =>
              fields.length > 0
                ? this.focusControl(fields[0])
                : this.errorAlert()?.nativeElement.focus(),
            { injector: this.injector },
          );
        },
      });
  }

  protected cancel(): void {
    if (!this.submitting()) {
      this.cancelled.emit();
    }
  }

  private focusControl(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formcontrolname="${name}"]`)?.focus();
  }
}
