import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Shared page for screens that are not built yet. Inputs come from the route's `data`. */
@Component({
  selector: 'app-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">{{ heading() }}</h1>
    <p class="mt-2 text-sm text-slate-600">Not built yet — planned in {{ milestoneLabel() }}.</p>
  `,
})
export class PlaceholderPage {
  readonly heading = input.required<string>();
  readonly milestones = input.required<readonly number[]>();

  protected readonly milestoneLabel = computed(() => formatMilestones(this.milestones()));
}

/** `[5]` → "Milestone 5"; `[2, 3]` → "Milestones 2 and 3". */
export function formatMilestones(milestones: readonly number[]): string {
  if (milestones.length <= 1) {
    return `Milestone ${milestones[0] ?? '?'}`;
  }
  const head = milestones.slice(0, -1).join(', ');
  return `Milestones ${head} and ${milestones[milestones.length - 1]}`;
}
