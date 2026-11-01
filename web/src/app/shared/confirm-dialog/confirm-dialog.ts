import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

let nextId = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal confirmation (`role="alertdialog"`). Render it with `@if` while a confirmation is pending.
 * On open, focus goes to "Cancel" (the safe choice); Tab stays inside the dialog; Escape cancels;
 * on close, focus returns to the element that had it before (usually the button that opened it).
 * While `pending`, the confirm button reads as disabled and Escape is ignored.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="fixed inset-0 z-40 bg-slate-900/40" aria-hidden="true"></div>
    <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        #panel
        role="alertdialog"
        aria-modal="true"
        [attr.aria-labelledby]="headingId"
        [attr.aria-describedby]="messageId"
        [attr.aria-busy]="pending()"
        class="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-lg bg-white p-6 shadow-lg"
        (keydown)="onKeydown($event)"
      >
        <h2 [id]="headingId" class="text-base font-semibold text-slate-900">{{ heading() }}</h2>
        <p [id]="messageId" class="mt-2 text-sm text-slate-700">{{ message() }}</p>
        @if (error(); as errorText) {
          <p
            role="alert"
            class="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {{ errorText }}
          </p>
        }
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <button
            #cancelButton
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            (click)="cancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-medium text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            [class]="
              tone() === 'danger'
                ? 'bg-red-700 hover:bg-red-800'
                : 'bg-accent-700 hover:bg-accent-800'
            "
            [attr.aria-disabled]="pending() ? 'true' : null"
            (click)="confirm()"
          >
            {{ pending() ? pendingLabel() : confirmLabel() }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmDialog {
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly pendingLabel = input('Working…');
  /** `danger` for destructive actions (red confirm button). */
  readonly tone = input<'primary' | 'danger'>('primary');
  readonly pending = input(false);
  /** Shown inside the dialog, e.g. when the action failed and can be retried. */
  readonly error = input<string | null>(null);

  readonly confirmed = output();
  readonly cancelled = output();

  protected readonly headingId = `confirm-dialog-heading-${++nextId}`;
  protected readonly messageId = `confirm-dialog-message-${nextId}`;

  private readonly document = inject(DOCUMENT);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    const previouslyFocused = this.document.activeElement;
    afterNextRender(() => this.cancelButton().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    });
  }

  protected confirm(): void {
    if (!this.pending()) {
      this.confirmed.emit();
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!this.pending()) {
        this.cancelled.emit();
      }
      return;
    }
    if (event.key === 'Tab') {
      this.keepFocusInside(event);
    }
  }

  /** Wraps Tab / Shift+Tab around the dialog's first and last focusable elements. */
  private keepFocusInside(event: KeyboardEvent): void {
    const panel = this.panel().nativeElement;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
