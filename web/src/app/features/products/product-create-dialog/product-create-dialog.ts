import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import {
  PRODUCT_CATALOG_ID_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SKU_MAX_LENGTH,
  ProductDetail,
} from '../../../core/products/product.models';
import { ProductsApiService } from '../../../core/products/products-api.service';
import { Dialog } from '../../../shared/dialog/dialog';
import {
  applyServerFieldErrors,
  errorMessage,
  focusFirstInvalidControl,
  maxLengthTrimmed,
  requiredTrimmed,
  showError,
} from '../../../shared/forms/form-helpers';

let nextId = 0;

/**
 * "Add product" dialog (any member): a product for a SKU not imported yet. Orders with that SKU are
 * linked to it. A 409 naming `sku` (the SKU already has a product) shows under the SKU field;
 * other errors above the form.
 */
@Component({
  selector: 'app-product-create-dialog',
  imports: [ReactiveFormsModule, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <app-dialog heading="Add product" [busy]="submitting()" (closed)="cancelled.emit()">
      <p class="text-sm text-slate-600">
        Products are created from your imported orders automatically. Add one here only for a SKU
        that is not in any imported order yet; orders with this SKU are linked to it.
      </p>
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
          <label [for]="idPrefix + '-sku'" class="block text-sm font-medium text-slate-800">
            SKU
          </label>
          <input
            [id]="idPrefix + '-sku'"
            type="text"
            formControlName="sku"
            autocomplete="off"
            spellcheck="false"
            data-autofocus
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.sku) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.sku)
                ? idPrefix + '-sku-hint ' + idPrefix + '-sku-error'
                : idPrefix + '-sku-hint'
            "
          />
          <p [id]="idPrefix + '-sku-hint'" class="mt-1 text-xs text-slate-600">
            Exactly as it appears in Meesho’s orders report.
          </p>
          @if (showError(form.controls.sku)) {
            <p [id]="idPrefix + '-sku-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.sku, messages.sku) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-name'" class="block text-sm font-medium text-slate-800">
            Name <span class="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            [id]="idPrefix + '-name'"
            type="text"
            formControlName="name"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.name) ? 'true' : null"
            [attr.aria-describedby]="showError(form.controls.name) ? idPrefix + '-name-error' : null"
          />
          @if (showError(form.controls.name)) {
            <p [id]="idPrefix + '-name-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.name, messages.name) }}
            </p>
          }
        </div>

        <div>
          <label [for]="idPrefix + '-catalog'" class="block text-sm font-medium text-slate-800">
            Catalog ID <span class="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            [id]="idPrefix + '-catalog'"
            type="text"
            formControlName="catalogId"
            autocomplete="off"
            spellcheck="false"
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 aria-invalid:border-red-600"
            [attr.aria-invalid]="showError(form.controls.catalogId) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.catalogId) ? idPrefix + '-catalog-error' : null
            "
          />
          @if (showError(form.controls.catalogId)) {
            <p [id]="idPrefix + '-catalog-error'" class="mt-1 text-sm text-red-700">
              {{ errorMessage(form.controls.catalogId, messages.catalogId) }}
            </p>
          }
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="submit"
            class="rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white hover:bg-accent-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            [attr.aria-disabled]="submitting() ? 'true' : null"
          >
            {{ submitting() ? 'Adding…' : 'Add product' }}
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
export class ProductCreateDialog {
  readonly accountId = input.required<string>();

  readonly saved = output<ProductDetail>();
  readonly cancelled = output();

  private readonly api = inject(ProductsApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly idPrefix = `product-create-${++nextId}`;
  protected readonly form = inject(NonNullableFormBuilder).group({
    sku: ['', [requiredTrimmed, maxLengthTrimmed(PRODUCT_SKU_MAX_LENGTH)]],
    name: ['', [maxLengthTrimmed(PRODUCT_NAME_MAX_LENGTH)]],
    catalogId: ['', [maxLengthTrimmed(PRODUCT_CATALOG_ID_MAX_LENGTH)]],
  });
  protected readonly messages = {
    sku: {
      required: 'Enter the SKU.',
      maxlength: `SKU must be at most ${PRODUCT_SKU_MAX_LENGTH} characters.`,
    },
    name: { maxlength: `Name must be at most ${PRODUCT_NAME_MAX_LENGTH} characters.` },
    catalogId: {
      maxlength: `Catalog ID must be at most ${PRODUCT_CATALOG_ID_MAX_LENGTH} characters.`,
    },
  } as const;
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  protected submit(): void {
    if (this.submitting()) {
      return;
    }
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement, this.form);
      return;
    }
    const sku = this.form.controls.sku.value.trim();
    const name = this.form.controls.name.value.trim();
    const catalogId = this.form.controls.catalogId.value.trim();
    this.submitting.set(true);
    this.api
      .create(this.accountId(), {
        sku,
        ...(name ? { name } : {}),
        ...(catalogId ? { catalogId } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => {
          this.submitting.set(false);
          this.saved.emit(product);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          const apiError = toApiError(error);
          // A duplicate SKU names `sku`; any other error (including a 409 without field details,
          // e.g. a disabled or busy account) is shown for the whole form.
          const fields = applyServerFieldErrors(this.form, apiError);
          if (fields.length === 0) {
            this.serverError.set(describeApiError(apiError));
          }
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

  private focusControl(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formcontrolname="${name}"]`)?.focus();
  }
}
