import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** `aria-sort` values used on a sorted column header. */
export type SortDirection = 'ascending' | 'descending';

/** `-orderDate` → `{ key: 'orderDate', direction: 'descending' }` (the API's sort format). */
export function parseSort(sort: string): { key: string; direction: SortDirection } {
  return sort.startsWith('-')
    ? { key: sort.slice(1), direction: 'descending' }
    : { key: sort, direction: 'ascending' };
}

/** The `aria-sort` of the column `key` under `sort`; `null` (attribute left out) when unsorted. */
export function ariaSort(sort: string, key: string): SortDirection | null {
  const current = parseSort(sort);
  return current.key === key ? current.direction : null;
}

/**
 * The sort after activating the column `key`: the sorted column flips direction; another column
 * starts ascending, or descending when `firstDescending` (dates and amounts: newest / largest).
 */
export function nextSort(sort: string, key: string, firstDescending = false): string {
  const current = parseSort(sort);
  if (current.key === key) {
    return current.direction === 'ascending' ? `-${key}` : key;
  }
  return firstDescending ? `-${key}` : key;
}

/**
 * The button inside a sortable column header. Put `[attr.aria-sort]="ariaSort(sort, key)"` on the
 * `<th>` itself, so assistive technology announces the sorted column and its direction.
 */
@Component({
  selector: 'app-sort-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-sm font-semibold text-slate-700 hover:text-slate-900"
      [attr.data-sort-key]="key()"
      (click)="toggle()"
    >
      {{ label() }}
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" class="size-4 shrink-0">
        @switch (direction()) {
          @case ('ascending') {
            <path d="M10 5l5 6H5l5-6z" />
          }
          @case ('descending') {
            <path d="M10 15l-5-6h10l-5 6z" />
          }
          @default {
            <path d="M10 3l4 5H6l4-5zm0 14l-4-5h8l-4 5z" opacity="0.4" />
          }
        }
      </svg>
    </button>
  `,
})
export class SortButton {
  /** The column's sort key, e.g. `orderDate`. */
  readonly key = input.required<string>();
  readonly label = input.required<string>();
  /** The list's current sort, e.g. `-orderDate`. */
  readonly sort = input.required<string>();
  /** Start descending when another column was sorted (dates, amounts). */
  readonly firstDescending = input(false);

  /** The new sort to apply. */
  readonly sortChange = output<string>();

  protected readonly direction = computed(() => ariaSort(this.sort(), this.key()));

  protected toggle(): void {
    this.sortChange.emit(nextSort(this.sort(), this.key(), this.firstDescending()));
  }
}
