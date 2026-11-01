import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Where a download stands. `error.status` is the HTTP status (0: no response). */
export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; status: number; message: string };

/**
 * One export on the Reports page: heading, what it contains, the page's filter fields (projected),
 * the column list (a disclosure) and "Download CSV", with the progress, success and error of the
 * last download. The page validates the filters and starts the download on `download`.
 */
@Component({
  selector: 'app-export-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      [attr.aria-labelledby]="cardId() + '-heading'"
      class="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4"
      [attr.data-testid]="cardId()"
      [attr.data-state]="state().kind"
    >
      <h2 [id]="cardId() + '-heading'" class="text-base font-semibold text-slate-900">
        {{ heading() }}
      </h2>
      <p class="mt-1 text-sm text-slate-600">{{ description() }}</p>
      <form
        class="mt-4 flex flex-1 flex-col"
        novalidate
        [attr.aria-label]="heading() + ' filters'"
        (submit)="submit($event)"
      >
        <div class="space-y-4"><ng-content /></div>
        <details class="mt-4 rounded-md border border-slate-200 text-sm" data-testid="columns">
          <summary class="cursor-pointer px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50">
            Columns ({{ columns().length }})
          </summary>
          <ul class="list-disc border-t border-slate-200 py-2 pr-3 pl-8 text-slate-700">
            @for (column of columns(); track column) {
              <li>{{ column }}</li>
            }
          </ul>
        </details>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            class="rounded-md bg-accent-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            [attr.aria-disabled]="state().kind === 'busy' || disabled() ? 'true' : null"
          >
            Download CSV
          </button>
          <p role="status" class="text-sm text-slate-700" data-testid="download-status">
            @switch (state().kind) {
              @case ('busy') {
                Preparing the file…
              }
              @case ('done') {
                Downloaded {{ filename() }}.
              }
            }
          </p>
        </div>
      </form>
      @if (errorState(); as error) {
        <div
          role="alert"
          class="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
          data-testid="download-error"
        >
          <p class="font-medium text-red-800">The file was not created.</p>
          <p class="mt-1 text-red-800">{{ error.message }}</p>
          @if (error.status === 422) {
            <p class="mt-1 text-red-800">
              Narrow the filters (a shorter date range, fewer statuses or types) and try again.
            </p>
          }
        </div>
      }
    </section>
  `,
})
export class ExportCard {
  /** Prefix of the card's ids and its `data-testid`. */
  readonly cardId = input.required<string>();
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
  readonly columns = input.required<readonly string[]>();
  readonly state = input<DownloadState>({ kind: 'idle' });
  /** True when the export cannot run (e.g. no seller account): the button says so but stays focusable. */
  readonly disabled = input(false);

  readonly download = output();

  protected filename(): string {
    const state = this.state();
    return state.kind === 'done' ? state.filename : '';
  }

  protected errorState(): { status: number; message: string } | null {
    const state = this.state();
    return state.kind === 'error' ? state : null;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.state().kind !== 'busy' && !this.disabled()) {
      this.download.emit();
    }
  }
}
