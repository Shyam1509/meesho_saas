import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The filter form above a list: the page projects its fields; "Apply filters" (or Enter in a
 * text field) emits `applied`, "Clear filters" (shown while any filter is applied) emits
 * `cleared`. The page validates and applies the values (by updating the URL query).
 */
@Component({
  selector: 'app-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      role="search"
      [attr.aria-label]="label()"
      class="rounded-lg border border-slate-200 bg-white p-4"
      novalidate
      (submit)="submit($event)"
    >
      <!-- Every field at most the bar's width: a long select option never makes a phone scroll. -->
      <div class="flex flex-wrap items-end gap-4 *:max-w-full">
        <ng-content />
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            class="rounded-md bg-accent-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-800"
          >
            Apply filters
          </button>
          @if (active()) {
            <button
              type="button"
              class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              (click)="cleared.emit()"
            >
              Clear filters
            </button>
          }
        </div>
      </div>
    </form>
  `,
})
export class FilterBar {
  /** The search landmark's name, e.g. "Filter orders". */
  readonly label = input.required<string>();
  /** True while any filter is applied: shows "Clear filters". */
  readonly active = input(false);

  readonly applied = output();
  readonly cleared = output();

  protected submit(event: Event): void {
    event.preventDefault();
    this.applied.emit();
  }
}
