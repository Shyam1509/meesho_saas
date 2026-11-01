import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * "Loading orders…" with a small spinner, as a polite status message. Put it inside the region
 * that is loading and mark that region `aria-busy`. The spinner only turns when the user has not
 * asked for reduced motion; the text alone carries the meaning.
 */
@Component({
  selector: 'app-loading-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p role="status" class="flex items-center gap-2 text-sm text-slate-700">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        class="size-4 shrink-0 text-slate-500 motion-safe:animate-spin"
        data-spinner
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity="0.3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
      <span>{{ text() }}</span>
    </p>
  `,
})
export class LoadingState {
  /** e.g. "Loading orders…". */
  readonly text = input.required<string>();
}
