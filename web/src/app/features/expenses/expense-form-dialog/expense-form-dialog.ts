import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { Observable } from 'rxjs';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import {
  DOUBLE_COUNTING_NOTE,
  EXPENSE_AMOUNT_LIMIT,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  Expense,
  ExpenseCategory,
  UpdateExpenseRequest,
} from '../../../core/expenses/expense.models';
import { ExpensesApiService } from '../../../core/expenses/expenses-api.service';
import { BUSINESS_TIME_ZONE } from '../../../core/products/product.models';
import { Dialog } from '../../../shared/dialog/dialog';
import { dateStringInTimeZone } from '../../../shared/format/format';
import {
  applyServerFieldErrors,
  dateOnly,
  decimalAmount,
  errorMessage,
  focusFirstInvalidControl,
  maxLengthTrimmed,
  notAfter,
  requiredTrimmed,
  showError,
} from '../../../shared/forms/form-helpers';

let nextId = 0;

export const NO_TARGET_MESSAGE =
  'There is no seller account or workspace to add this expense to. Close this dialog, pick one and try again.';

/** Where a new expense goes: one seller account, or the whole workspace. */
export type ExpenseTarget =
  | { kind: 'account'; accountId: string; label: string }
  | { kind: 'workspace'; workspaceId: string; label: string };

/** Today in India, the API's "today" for expense dates. */
export function todayInIndia(now: Date = new Date()): string {
  return dateStringInTimeZone(now, BUSINESS_TIME_ZONE);
}

/**
 * Add or edit one expense (owners only), in a dialog. A category that needs a description (`other`)
 * makes the description required; the amount is in rupees, above zero, with up to 2 decimals; the
 * date can't be in the future (India time). The scope of an existing expense never changes.
 */
@Component({
  selector: 'app-expense-form-dialog',
  imports: [ReactiveFormsModule, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <app-dialog [heading]="heading()" [busy]="submitting()" (closed)="cancel()">
      <p
        class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        data-testid="double-counting-note"
      >
        {{ doubleCountingNote }}
      </p>
      <p class="mt-3 text-sm text-slate-700" data-testid="expense-target">{{ targetText() }}</p>
      @if (serverError(); as message) {
        <div
          #errorAlert
          role="alert"
          tabindex="-1"
          class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {{ message }}
        </div>
      }
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="mt-4 grid gap-4"
        [attr.aria-busy]="submitting()"
      >
        <div>
          <label [for]="idPrefix + '-date'" class="block text-sm font-medium text-slate-800">
            Date
          </label>
          <input
            [id]="idPrefix + '-date'"
            type="date"
            formControlName="expenseDate"
            data-autofocus
            [max]="today"
            class="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.expenseDate) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.expenseDate) ? idPrefix + '-date-error' : null
            "
          />
          @if (showError(form.controls.expenseDate)) {
            <p [id]="idPrefix + '-date-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.expenseDate, messages.expenseDate) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-category'" class="block text-sm font-medium text-slate-800">
            Category
          </label>
          <select
            [id]="idPrefix + '-category'"
            formControlName="category"
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white py-2 pr-8 pl-3 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.category) ? 'true' : null"
            [attr.aria-describedby]="categoryDescribedBy()"
          >
            <option value="">Choose a category</option>
            @for (category of categoryOptions(); track category.key) {
              <option [value]="category.key">{{ category.label }}</option>
            }
          </select>
          @if (selectedCategory(); as category) {
            <p [id]="idPrefix + '-category-help'" class="mt-1 text-xs text-slate-600">
              {{ category.help }}
            </p>
          }
          @if (categories().length === 0) {
            <p [id]="idPrefix + '-category-help'" class="mt-1 text-xs text-red-700">
              The categories could not be loaded. Close this dialog and try again.
            </p>
          }
          @if (showError(form.controls.category)) {
            <p [id]="idPrefix + '-category-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.category, messages.category) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-description'" class="block text-sm font-medium text-slate-800">
            Description
            @if (!descriptionRequired()) {
              <span class="font-normal text-slate-600">(optional)</span>
            }
          </label>
          <input
            [id]="idPrefix + '-description'"
            type="text"
            formControlName="description"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-required]="descriptionRequired() ? 'true' : null"
            [attr.aria-invalid]="showError(form.controls.description) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.description) ? idPrefix + '-description-error' : null
            "
          />
          @if (showError(form.controls.description)) {
            <p [id]="idPrefix + '-description-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.description, messages.description) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-amount'" class="block text-sm font-medium text-slate-800">
            Amount (₹)
          </label>
          <input
            [id]="idPrefix + '-amount'"
            type="text"
            inputmode="decimal"
            formControlName="amount"
            autocomplete="off"
            class="mt-1 block w-48 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.amount) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.amount)
                ? idPrefix + '-amount-hint ' + idPrefix + '-amount-error'
                : idPrefix + '-amount-hint'
            "
          />
          <p [id]="idPrefix + '-amount-hint'" class="mt-1 text-xs text-slate-600">
            In rupees, with up to 2 decimals (for example 1250.50).
          </p>
          @if (showError(form.controls.amount)) {
            <p [id]="idPrefix + '-amount-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.amount, messages.amount) }}
            </p>
          }
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="submit"
            class="rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white hover:bg-accent-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            [attr.aria-disabled]="submitting() ? 'true' : null"
          >
            {{ submitting() ? 'Saving…' : expense() ? 'Save changes' : 'Add expense' }}
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            (click)="cancel()"
          >
            Cancel
          </button>
        </div>
      </form>
    </app-dialog>
  `,
})
export class ExpenseFormDialog {
  readonly categories = input.required<readonly ExpenseCategory[]>();
  /** The expense to edit, or `null` to add one to {@link target}. */
  readonly expense = input<Expense | null>(null);
  /** Where a new expense goes (ignored when editing: the scope never changes). */
  readonly target = input<ExpenseTarget | null>(null);
  /** Shown for an existing expense: its seller account's name, or the workspace. */
  readonly expenseScopeLabel = input('');

  readonly saved = output<Expense>();
  readonly cancelled = output();

  private readonly api = inject(ExpensesApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly idPrefix = `expense-form-${++nextId}`;
  protected readonly doubleCountingNote = DOUBLE_COUNTING_NOTE;
  protected readonly today = todayInIndia();

  /** Required when the chosen category says so (`other`). */
  private readonly descriptionRule = (control: AbstractControl): ValidationErrors | null => {
    const category = control.parent?.get('category')?.value as string | undefined;
    return category && this.requiresDescription(category) && String(control.value ?? '').trim() === ''
      ? { requiredFor: true }
      : null;
  };

  protected readonly form = inject(NonNullableFormBuilder).group({
    expenseDate: ['', [requiredTrimmed, dateOnly, notAfter(() => todayInIndia())]],
    category: ['', [requiredTrimmed]],
    description: ['', [maxLengthTrimmed(EXPENSE_DESCRIPTION_MAX_LENGTH), this.descriptionRule]],
    amount: [
      '',
      [
        requiredTrimmed,
        decimalAmount({ maxDecimals: 2, positive: true, limit: EXPENSE_AMOUNT_LIMIT }),
      ],
    ],
  });
  protected readonly messages = {
    expenseDate: {
      required: 'Enter the date of the expense.',
      date: 'Enter a valid date.',
      after: 'The date can’t be in the future.',
    },
    category: { required: 'Choose a category.' },
    description: {
      requiredFor: 'Describe the expense: this category needs a description.',
      maxlength: `Description must be at most ${EXPENSE_DESCRIPTION_MAX_LENGTH} characters.`,
    },
    amount: {
      required: 'Enter the amount.',
      format: 'Enter rupees as a number with up to 2 decimals, for example 1250.50 (no ₹ sign or commas).',
      positive: 'The amount must be more than ₹0.',
      limit: 'The amount must be less than ₹10,00,00,00,000.',
    },
  } as const;

  private readonly categoryValue = toSignal(this.form.controls.category.valueChanges, {
    initialValue: '',
  });
  /** The allowed categories, plus an edited expense's category if the list no longer has it. */
  protected readonly categoryOptions = computed<readonly ExpenseCategory[]>(() => {
    const categories = this.categories();
    const expense = this.expense();
    if (expense && !categories.some((c) => c.key === expense.category)) {
      return [
        ...categories,
        { key: expense.category, label: expense.categoryLabel, help: '', descriptionRequired: false },
      ];
    }
    return categories;
  });
  protected readonly selectedCategory = computed(
    () => this.categories().find((c) => c.key === this.categoryValue()) ?? null,
  );
  protected readonly descriptionRequired = computed(() =>
    this.requiresDescription(this.categoryValue()),
  );
  protected readonly heading = computed(() => (this.expense() ? 'Edit expense' : 'Add expense'));
  protected readonly targetText = computed(() => {
    if (this.expense()) {
      return `Belongs to ${this.expenseScopeLabel()}. This can’t be changed.`;
    }
    const target = this.target();
    if (!target) {
      return '';
    }
    return target.kind === 'account'
      ? `Adds an expense of the seller account ${target.label}.`
      : `Adds a workspace-wide expense to ${target.label} (it belongs to no single seller account).`;
  });
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  constructor() {
    // A category change can make the description required (or not).
    this.form.controls.category.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.description.updateValueAndValidity());
    // Fill the form from the expense being edited (a new one starts on today's date).
    effect(() => {
      const expense = this.expense();
      untracked(() =>
        this.form.reset({
          expenseDate: expense?.expenseDate ?? this.today,
          category: expense?.category ?? '',
          description: expense?.description ?? '',
          amount: expense?.amount ?? '',
        }),
      );
    });
  }

  /** The category select's help text and error, when shown. */
  protected categoryDescribedBy(): string | null {
    const ids: string[] = [];
    if (this.selectedCategory() || this.categories().length === 0) {
      ids.push(`${this.idPrefix}-category-help`);
    }
    if (showError(this.form.controls.category)) {
      ids.push(`${this.idPrefix}-category-error`);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  }

  protected submit(): void {
    if (this.submitting()) {
      return;
    }
    this.serverError.set(null);
    this.form.controls.description.updateValueAndValidity();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement, this.form);
      return;
    }
    if (this.expense() === null && this.target() === null) {
      // Nowhere to add it (no account or workspace): say so instead of closing silently.
      this.serverError.set(NO_TARGET_MESSAGE);
      afterNextRender(() => this.errorAlert()?.nativeElement.focus(), { injector: this.injector });
      return;
    }
    const request = this.buildRequest();
    if (request === null) {
      // Edit with nothing changed: nothing to send.
      this.cancelled.emit();
      return;
    }
    this.submitting.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.submitting.set(false);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const apiError = toApiError(error);
        const fields = applyServerFieldErrors(this.form, apiError);
        this.serverError.set(fields.length === 0 ? describeApiError(apiError) : null);
        afterNextRender(
          () =>
            fields.length > 0
              ? this.focusControl(fields[0])
              : this.errorAlert()?.nativeElement.focus(),
          { injector: this.injector },
        );
      },
    });
  }

  protected cancel(): void {
    if (!this.submitting()) {
      this.cancelled.emit();
    }
  }

  private requiresDescription(categoryKey: string): boolean {
    const category = this.categories().find((c) => c.key === categoryKey);
    return category ? category.descriptionRequired : categoryKey === 'other';
  }

  /** Create: trimmed values, blank description left out. Edit: only the changed fields. */
  private buildRequest(): Observable<Expense> | null {
    const values = this.form.getRawValue();
    const expenseDate = values.expenseDate.trim();
    const category = values.category;
    const description = values.description.trim();
    const amount = values.amount.trim();
    const expense = this.expense();
    if (expense === null) {
      const body = { expenseDate, category, amount, ...(description ? { description } : {}) };
      const target = this.target();
      if (target === null) {
        return null;
      }
      return target.kind === 'account'
        ? this.api.createForAccount(target.accountId, body)
        : this.api.createForWorkspace(target.workspaceId, body);
    }
    const changes: UpdateExpenseRequest = {};
    if (expenseDate !== expense.expenseDate) {
      changes.expenseDate = expenseDate;
    }
    if (category !== expense.category) {
      changes.category = category;
    }
    if ((description || null) !== expense.description) {
      changes.description = description || null;
    }
    if (!sameAmount(amount, expense.amount)) {
      changes.amount = amount;
    }
    return Object.keys(changes).length > 0 ? this.api.update(expense.id, changes) : null;
  }

  private focusControl(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formcontrolname="${name}"]`)?.focus();
  }
}

/** `"1200.5"` and `"1200.50"` are the same amount. */
function sameAmount(a: string, b: string): boolean {
  return a === b || (Number.isFinite(Number(a)) && Number(a) === Number(b));
}
