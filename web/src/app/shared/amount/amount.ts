import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { MISSING, formatInr } from '../format/format';

/**
 * An amount as reported (decimal string) in INR: "₹1,249.50", "₹0.00" for zero, and "—" with a
 * screen-reader text ("not reported") when there is no value, so zero and missing never look
 * alike. Put it in a right-aligned, `tabular-nums` cell.
 */
@Component({
  selector: 'app-amount',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'whitespace-nowrap', '[attr.data-missing]': 'missing() ? "true" : null' },
  template: `
    @if (missing()) {
      <span aria-hidden="true">{{ dash }}</span><span class="sr-only"> {{ missingLabel() }}</span>
    } @else {
      {{ text() }}
    }
  `,
})
export class Amount {
  readonly value = input.required<string | number | null | undefined>();
  /** What a screen reader says for a missing value. */
  readonly missingLabel = input('not reported');

  protected readonly dash = MISSING;
  protected readonly text = computed(() => formatInr(this.value()));
  protected readonly missing = computed(() => this.text() === MISSING);
}
