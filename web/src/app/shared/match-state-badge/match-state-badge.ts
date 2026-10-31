import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { MatchMethod, matchStateLabel } from '../../core/settlements/settlement.models';

const TONES: Record<string, string> = {
  matched: 'bg-green-50 text-green-800 ring-green-700/20',
  unmatched: 'bg-amber-50 text-amber-800 ring-amber-700/20',
  account_level: 'bg-slate-100 text-slate-700 ring-slate-600/20',
};

/**
 * A settlement entry's match state as a pill: "Matched (auto)", "Matched (manual)", "Unmatched",
 * "Account-level". The text carries the meaning; the colour only reinforces it.
 */
@Component({
  selector: 'app-match-state-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span
      class="rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1"
      [class]="tone()"
      [attr.data-match-state]="state()"
    >
      {{ label() }}
    </span>
  `,
})
export class MatchStateBadge {
  readonly state = input.required<string>();
  readonly method = input<MatchMethod | null>(null);

  protected readonly label = computed(() => {
    const base = matchStateLabel(this.state());
    const method = this.method();
    return this.state() === 'matched' && method ? `${base} (${method})` : base;
  });
  protected readonly tone = computed(
    () => TONES[this.state()] ?? 'bg-slate-100 text-slate-700 ring-slate-600/20',
  );
}
