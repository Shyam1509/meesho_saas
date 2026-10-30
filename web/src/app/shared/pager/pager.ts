import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { formatCount } from '../format/format';

/**
 * "Showing 21–40 of 57 imports" with Previous / Next for a server-paginated list. The buttons stay
 * focusable at either end (`aria-disabled`), so keyboard focus is never lost while paging.
 */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav
      [attr.aria-label]="label()"
      class="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p class="text-slate-600">{{ rangeText() }}</p>
      @if (pageCount() > 1) {
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            [attr.aria-disabled]="!canGoBack() ? 'true' : null"
            (click)="go(page() - 1)"
          >
            Previous<span class="sr-only"> page</span>
          </button>
          <span class="text-slate-600">Page {{ page() }} of {{ pageCount() }}</span>
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            [attr.aria-disabled]="!canGoForward() ? 'true' : null"
            (click)="go(page() + 1)"
          >
            Next<span class="sr-only"> page</span>
          </button>
        </div>
      }
    </nav>
  `,
})
export class Pager {
  /** 1-based. */
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  /** The navigation landmark's name, e.g. "Import history pages". */
  readonly label = input.required<string>();
  /** Plural noun for the range text, e.g. "imports". */
  readonly itemLabel = input('items');
  /** True while a page is loading: the buttons do nothing. */
  readonly busy = input(false);

  readonly pageChange = output<number>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))),
  );
  protected readonly canGoBack = computed(() => !this.busy() && this.page() > 1);
  protected readonly canGoForward = computed(
    () => !this.busy() && this.page() < this.pageCount(),
  );
  protected readonly rangeText = computed(() => {
    const total = this.total();
    if (total === 0) {
      return `No ${this.itemLabel()}`;
    }
    const first = (this.page() - 1) * this.pageSize() + 1;
    const last = Math.min(total, this.page() * this.pageSize());
    return `Showing ${formatCount(first)}–${formatCount(last)} of ${formatCount(total)} ${this.itemLabel()}`;
  });

  protected go(page: number): void {
    if (this.busy() || page < 1 || page > this.pageCount() || page === this.page()) {
      return;
    }
    this.pageChange.emit(page);
  }
}
