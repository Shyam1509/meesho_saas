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

/**
 * Classes for the action buttons row at the end of a dialog's content: it sticks to the bottom of
 * the scrolling area (so Save / Cancel stay reachable on a phone) across the content's full width.
 * Its parent must be a block or flex container, not a grid (a grid cell would hold it in place).
 */
export const DIALOG_ACTIONS_CLASS =
  'sticky bottom-0 -mx-4 mt-2 flex flex-wrap gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog (`role="dialog"`) around projected content, for tasks that need more than a yes /
 * no (`ConfirmDialog` covers that). Render it with `@if`. On open, focus goes to the element marked
 * `data-autofocus`, else the first focusable one; Tab stays inside; Escape or "Close" (unless
 * `busy`) emits `closed`; on close, focus returns to the element that had it before.
 *
 * It fits small screens: full width up to its `width`, never taller than the viewport, the header
 * always visible and the content scrolling inside. Give the row of action buttons at the end of the
 * content {@link DIALOG_ACTIONS_CLASS} so it stays in view while a long form scrolls.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="fixed inset-0 z-40 bg-slate-900/40" aria-hidden="true"></div>
    <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        #panel
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="headingId"
        [attr.aria-busy]="busy()"
        class="flex max-h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-lg"
        [class.max-w-md]="width() === 'normal'"
        [class.max-w-3xl]="width() === 'wide'"
        (keydown)="onKeydown($event)"
      >
        <div
          class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6"
        >
          <h2 [id]="headingId" class="text-base font-semibold text-slate-900">{{ heading() }}</h2>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            [attr.aria-disabled]="busy() ? 'true' : null"
            (click)="close()"
          >
            Close<span class="sr-only"> dialog</span>
          </button>
        </div>
        <!-- scroll-pb-20: a field focused by Tab scrolls clear of the sticky actions row. -->
        <div class="min-h-0 scroll-pb-20 overflow-y-auto overscroll-contain" data-dialog-body>
          <div class="px-4 pt-4 sm:px-6">
            <ng-content />
          </div>
        </div>
      </div>
    </div>
  `,
})
export class Dialog {
  readonly heading = input.required<string>();
  /** While true, Escape and "Close" do nothing (a request is in flight). */
  readonly busy = input(false);
  readonly width = input<'normal' | 'wide'>('normal');

  readonly closed = output();

  protected readonly headingId = `dialog-heading-${++nextId}`;

  private readonly document = inject(DOCUMENT);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    const previouslyFocused = this.document.activeElement;
    afterNextRender(() => {
      const panel = this.panel().nativeElement;
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    });
    inject(DestroyRef).onDestroy(() => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    });
  }

  protected close(): void {
    if (!this.busy()) {
      this.closed.emit();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
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
