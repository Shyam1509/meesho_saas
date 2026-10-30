import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  viewChild,
} from '@angular/core';

import { ApiFieldError } from '../../core/api/api-error';

/**
 * An error box listing every problem the API (or a client check) found: a heading, an optional
 * message and one line per reason, grouped by the field it names. `role="alert"` announces it;
 * call {@link focus} to move keyboard focus to it.
 */
@Component({
  selector: 'app-validation-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      #box
      role="alert"
      tabindex="-1"
      class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p class="font-semibold">{{ heading() }}</p>
      @if (message(); as text) {
        <p class="mt-1">{{ text }}</p>
      }
      @if (details().length > 0) {
        <ul class="mt-2 list-disc space-y-1 pl-5">
          @for (detail of details(); track $index) {
            @for (reason of detail.reasons; track $index) {
              <li>
                @if (labelFor()(detail.field); as label) {
                  <span class="font-medium">{{ label }}:</span>
                }
                {{ reason }}
              </li>
            }
          }
        </ul>
      }
    </div>
  `,
})
export class ValidationSummary {
  readonly heading = input.required<string>();
  readonly message = input<string | null>(null);
  readonly details = input<readonly ApiFieldError[]>([]);
  /** Label shown before a field's reasons; return '' to show the reason alone. */
  readonly labelFor = input<(field: string) => string>((field) => field);

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  focus(): void {
    this.box().nativeElement.focus();
  }
}
