import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

export interface CheckboxOption {
  value: string;
  label: string;
}

/**
 * A multi-select as a disclosure ("Status: 2 selected") holding a fieldset of checkboxes, so it is
 * keyboard-operable with native controls only. Selected values that are not among the options
 * (e.g. from an old link) are still listed, so they can be cleared.
 */
@Component({
  selector: 'app-checkbox-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <details class="group rounded-md border border-slate-300 bg-white text-sm">
      <summary
        class="cursor-pointer rounded-md px-3 py-1.5 text-slate-900 select-none hover:bg-slate-50"
      >
        <span class="font-medium">{{ legend() }}: </span>{{ summary() }}
      </summary>
      <fieldset class="max-h-56 overflow-y-auto border-t border-slate-200 px-3 py-2">
        <legend class="sr-only">{{ legend() }}</legend>
        @if (allOptions().length === 0) {
          <p class="py-1 text-slate-600">{{ emptyText() }}</p>
        }
        @for (option of allOptions(); track option.value; let i = $index) {
          <div class="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              [id]="idPrefix() + '-' + i"
              class="size-4 rounded border-slate-300"
              [value]="option.value"
              [checked]="isSelected(option.value)"
              (change)="toggle(option.value, $event)"
            />
            <label [for]="idPrefix() + '-' + i" class="text-slate-800">{{ option.label }}</label>
          </div>
        }
      </fieldset>
    </details>
  `,
})
export class CheckboxGroup {
  readonly legend = input.required<string>();
  readonly idPrefix = input.required<string>();
  readonly options = input.required<readonly CheckboxOption[]>();
  readonly emptyText = input('Nothing to choose from.');
  readonly selected = model<readonly string[]>([]);

  protected readonly allOptions = computed<CheckboxOption[]>(() => {
    const options = [...this.options()];
    for (const value of this.selected()) {
      if (!options.some((o) => o.value === value)) {
        options.push({ value, label: value });
      }
    }
    return options;
  });
  protected readonly summary = computed(() => {
    const selected = this.selected();
    if (selected.length === 0) {
      return 'Any';
    }
    return selected.length === 1 ? this.labelOf(selected[0]) : `${selected.length} selected`;
  });

  protected isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  protected toggle(value: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const without = this.selected().filter((v) => v !== value);
    this.selected.set(checked ? [...without, value] : without);
  }

  private labelOf(value: string): string {
    return this.options().find((o) => o.value === value)?.label ?? value;
  }
}
