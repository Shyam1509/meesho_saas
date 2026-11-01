import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

import { isDateRangeValid } from '../url-state/url-state';

/**
 * A "from – to" pair of date inputs (`YYYY-MM-DD`, both inclusive) in a fieldset, e.g. "Order
 * date". Says so when "from" is after "to"; the parent must not apply such a range (see
 * `isDateRangeValid`).
 */
@Component({
  selector: 'app-date-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset [attr.aria-describedby]="invalid() ? errorId() : null">
      <legend class="text-sm font-medium text-slate-800">{{ legend() }}</legend>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <label [for]="idPrefix() + '-from'" class="sr-only">{{ legend() }} from</label>
        <input
          type="date"
          [id]="idPrefix() + '-from'"
          class="rounded-md border border-slate-500 bg-white px-2 py-1.5 text-sm text-slate-900"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [value]="from()"
          (change)="from.set(valueOf($event))"
        />
        <span aria-hidden="true" class="text-sm text-slate-600">to</span>
        <label [for]="idPrefix() + '-to'" class="sr-only">{{ legend() }} to</label>
        <input
          type="date"
          [id]="idPrefix() + '-to'"
          class="rounded-md border border-slate-500 bg-white px-2 py-1.5 text-sm text-slate-900"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [value]="to()"
          (change)="to.set(valueOf($event))"
        />
      </div>
      @if (invalid()) {
        <p [id]="errorId()" class="mt-1 text-sm text-red-700" data-testid="date-range-error">
          The start date must be on or before the end date.
        </p>
      }
    </fieldset>
  `,
})
export class DateRange {
  readonly legend = input.required<string>();
  /** Prefix for the inputs' ids (`<prefix>-from`, `<prefix>-to`). */
  readonly idPrefix = input.required<string>();
  /** `YYYY-MM-DD` or `''`. */
  readonly from = model('');
  readonly to = model('');

  protected readonly invalid = computed(() => !isDateRangeValid(this.from(), this.to()));
  protected readonly errorId = computed(() => `${this.idPrefix()}-error`);

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
