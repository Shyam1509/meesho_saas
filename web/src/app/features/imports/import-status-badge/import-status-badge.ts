import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ImportStatus, importStatusLabel } from '../../../core/imports/import.models';

const TONES: Record<ImportStatus, string> = {
  previewed: 'bg-accent-50 text-accent-800 ring-accent-700/20',
  importing: 'bg-amber-50 text-amber-800 ring-amber-700/20',
  completed: 'bg-green-50 text-green-800 ring-green-700/20',
  failed: 'bg-red-50 text-red-800 ring-red-700/20',
  cancelled: 'bg-slate-100 text-slate-700 ring-slate-600/20',
};

/** An import's status as a pill. The text carries the meaning; the colour only reinforces it. */
@Component({
  selector: 'app-import-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span
      class="rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1"
      [class]="tone()"
      [attr.data-status]="status()"
    >
      {{ label() }}
    </span>
  `,
})
export class ImportStatusBadge {
  readonly status = input.required<ImportStatus>();

  protected readonly label = computed(() => importStatusLabel(this.status()));
  protected readonly tone = computed(
    () => TONES[this.status()] ?? 'bg-slate-100 text-slate-700 ring-slate-600/20',
  );
}
