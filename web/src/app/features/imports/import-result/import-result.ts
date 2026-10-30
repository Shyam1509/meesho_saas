import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ImportDetail } from '../../../core/imports/import.models';
import { formatCount, plural } from '../../../shared/format/format';
import { CountPipe } from '../../../shared/format/format.pipes';

let nextId = 0;

/** The announcement after a confirm or retry completed: every count, "—" when not known. */
export function importResultNotice(job: ImportDetail): string {
  return (
    `Imported ${job.originalFilename}: ${formatCount(job.insertedCount)} inserted, ` +
    `${formatCount(job.updatedCount)} updated, ${formatCount(job.unchangedCount)} unchanged, ` +
    `${formatCount(job.historyOnlyCount)} history only, ${formatCount(job.errorRows)} skipped.`
  );
}

/**
 * The outcome of a completed import: success, or partial success when rows with errors were
 * skipped, with the inserted / updated / unchanged / history-only / skipped counts. Call {@link focus} to move
 * focus to its heading after a confirm.
 */
@Component({
  selector: 'app-import-result',
  imports: [RouterLink, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let item = job();
    <section
      [attr.aria-labelledby]="headingId"
      class="rounded-lg border p-5"
      [class]="partial() ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'"
      [attr.data-outcome]="partial() ? 'partial' : 'success'"
    >
      <h2
        #heading
        [id]="headingId"
        tabindex="-1"
        class="text-base font-semibold focus-visible:outline-none"
        [class]="partial() ? 'text-amber-900' : 'text-green-900'"
      >
        {{ title() }}
      </h2>
      <p class="mt-1 text-sm text-slate-800">
        <span class="font-medium break-all">{{ item.originalFilename }}</span>
        @if (partial()) {
          — the valid rows were imported; {{ skippedText() }} with errors
          {{ item.errorRows === 1 ? 'was' : 'were' }} not.
        } @else {
          — every row was imported.
        }
      </p>
      <dl
        class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        data-testid="result-counts"
      >
        <div class="rounded-md border border-slate-200 bg-white p-3">
          <dt class="text-xs font-medium text-slate-600">Inserted</dt>
          <dd class="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
            {{ item.insertedCount | count }}
          </dd>
        </div>
        <div class="rounded-md border border-slate-200 bg-white p-3">
          <dt class="text-xs font-medium text-slate-600">Updated</dt>
          <dd class="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
            {{ item.updatedCount | count }}
          </dd>
        </div>
        <div class="rounded-md border border-slate-200 bg-white p-3">
          <dt class="text-xs font-medium text-slate-600">Unchanged</dt>
          <dd class="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
            {{ item.unchangedCount | count }}
          </dd>
        </div>
        <div class="rounded-md border border-slate-200 bg-white p-3">
          <dt class="text-xs font-medium text-slate-600">
            History only <span class="block font-normal">(older than the saved status)</span>
          </dt>
          <dd class="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
            {{ item.historyOnlyCount | count }}
          </dd>
        </div>
        <div class="rounded-md border border-slate-200 bg-white p-3">
          <dt class="text-xs font-medium text-slate-600">Skipped (errors)</dt>
          <dd class="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
            {{ item.errorRows | count }}
          </dd>
        </div>
      </dl>
      @if (showDetailsLink()) {
        <a
          [routerLink]="['/imports', item.id]"
          class="mt-4 inline-block rounded-sm text-sm font-medium text-accent-700 underline hover:text-accent-800"
        >
          View import details<span class="sr-only"> for {{ item.originalFilename }}</span>
        </a>
      }
    </section>
  `,
})
export class ImportResult {
  /** A `completed` import. */
  readonly job = input.required<ImportDetail>();
  readonly showDetailsLink = input(true);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  protected readonly headingId = `import-result-heading-${++nextId}`;
  protected readonly partial = computed(() => (this.job().errorRows ?? 0) > 0);
  protected readonly skippedText = computed(() => plural(this.job().errorRows ?? 0, 'row'));
  protected readonly title = computed(() =>
    this.partial() ? `Imported, ${this.skippedText()} skipped` : 'Import completed',
  );

  focus(): void {
    this.heading().nativeElement.focus();
  }
}
