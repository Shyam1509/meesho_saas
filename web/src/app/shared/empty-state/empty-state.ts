import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A list with nothing to show, in a dashed box: a short heading ("No orders for this account
 * yet.") and the projected explanation. Put the way forward (a link, or "Clear filters" when
 * filters hide everything) in an element marked `emptyStateAction`; it goes below the text.
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="max-w-2xl rounded-lg border border-dashed border-slate-300 bg-white p-6">
      <p class="text-sm font-medium text-slate-900">{{ heading() }}</p>
      <p class="mt-1 text-sm text-slate-600"><ng-content /></p>
      <ng-content select="[emptyStateAction]" />
    </div>
  `,
})
export class EmptyState {
  readonly heading = input.required<string>();
}
