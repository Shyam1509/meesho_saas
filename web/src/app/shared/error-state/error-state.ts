import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EnvironmentInjector,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Why something could not be loaded, as an alert: a heading ("The orders could not be loaded."),
 * the error text (from `describeApiError`, which ends a server error with its support reference,
 * "(Reference: …)") and, unless `retryable` is false, a "Try again" button that emits `retry`.
 * Anything projected goes between the text and the button. The page then usually replaces this box
 * with its loading state, so focus moves to the section around it (a labelled `<section>`, region
 * or tab panel; else the page's `<h1>`) instead of being lost with the button.
 */
@Component({
  selector: 'app-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div role="alert" class="max-w-2xl rounded-md border border-red-200 bg-red-50 p-4 text-sm">
      <p class="font-medium text-red-800">{{ heading() }}</p>
      @if (message()) {
        <p class="mt-1 text-red-800" [attr.data-testid]="messageTestId()">{{ message() }}</p>
      }
      <ng-content />
      @if (retryable()) {
        <button
          type="button"
          class="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          (click)="tryAgain()"
        >
          Try again
        </button>
      }
    </div>
  `,
})
export class ErrorState {
  /** What failed, e.g. "The orders could not be loaded." */
  readonly heading = input.required<string>();
  /** Why, as `describeApiError` puts it. */
  readonly message = input<string | null>(null);
  /** False hides "Try again" (e.g. when retrying cannot help). */
  readonly retryable = input(true);
  /** `data-testid` of the message paragraph, for pages whose tests read it. */
  readonly messageTestId = input<string | null>(null);

  readonly retry = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // The app's injector, not this component's: the focus move runs after this box is gone.
  private readonly appInjector = inject(EnvironmentInjector);

  protected tryAgain(): void {
    const target = this.focusTargetAfterRetry();
    this.retry.emit();
    if (target) {
      afterNextRender(
        () => {
          if (target.isConnected) {
            if (!target.hasAttribute('tabindex')) {
              // Focusable by script only, never a Tab stop.
              target.setAttribute('tabindex', '-1');
            }
            target.focus();
          }
        },
        { injector: this.appInjector },
      );
    }
  }

  /** The nearest labelled section around this box, else the page heading (or `<main>`). */
  private focusTargetAfterRetry(): HTMLElement | null {
    const host = this.host.nativeElement;
    const section = host.parentElement?.closest<HTMLElement>(
      'section[aria-labelledby], [role="region"], [role="tabpanel"]',
    );
    if (section) {
      return section;
    }
    const main = host.closest('main');
    return main?.querySelector('h1') ?? main;
  }
}
