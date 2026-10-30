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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { Observable } from 'rxjs';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import {
  MEESHO_SUPPLIER_ID_MAX_LENGTH,
  MEESHO_SUPPLIER_ID_PATTERN,
  SELLER_ACCOUNT_NAME_MAX_LENGTH,
  SellerAccount,
  UpdateSellerAccountRequest,
} from '../../../core/seller-accounts/seller-account.models';
import { SellerAccountsApiService } from '../../../core/seller-accounts/seller-accounts-api.service';
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
 * Add or edit one seller account (owners only). Saves through the API itself and emits the saved
 * account; a 409 (duplicate name or supplier id) shows under the field the API names.
 */
@Component({
  selector: 'app-seller-account-form',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-account-form.html',
  host: { class: 'block' },
})
export class SellerAccountForm {
  readonly workspaceId = input.required<string>();
  /** The account to edit, or `null` to add a new one. */
  readonly account = input<SellerAccount | null>(null);

  readonly saved = output<SellerAccount>();
  readonly cancelled = output();

  private readonly api = inject(SellerAccountsApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly idPrefix = `seller-account-form-${++nextId}`;
  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: ['', [requiredTrimmed, maxLengthTrimmed(SELLER_ACCOUNT_NAME_MAX_LENGTH)]],
    meeshoSupplierId: ['', [maxLengthTrimmed(MEESHO_SUPPLIER_ID_MAX_LENGTH), supplierIdFormat]],
  });
  protected readonly messages = {
    displayName: {
      required: 'Enter a display name.',
      maxlength: `Display name must be at most ${SELLER_ACCOUNT_NAME_MAX_LENGTH} characters.`,
    },
    meeshoSupplierId: {
      maxlength: `Supplier ID must be at most ${MEESHO_SUPPLIER_ID_MAX_LENGTH} characters.`,
      format: 'Use only letters, numbers, hyphens (-) and underscores (_).',
    },
  } as const;

  protected readonly heading = computed(() => {
    const account = this.account();
    return account ? `Edit ${account.displayName}` : 'Add seller account';
  });
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  constructor() {
    // (Re)fill the form whenever a different account is being edited, then focus its first field.
    effect(() => {
      const account = this.account();
      untracked(() => {
        this.form.reset({
          displayName: account?.displayName ?? '',
          meeshoSupplierId: account?.meeshoSupplierId ?? '',
        });
        this.serverError.set(null);
        afterNextRender(() => this.focusControl('displayName'), { injector: this.injector });
      });
    });
  }

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

    const request = this.buildRequest();
    if (request === null) {
      // Edit with nothing changed: nothing to send.
      this.cancelled.emit();
      return;
    }
    this.submitting.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (account) => {
        this.submitting.set(false);
        this.saved.emit(account);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const fields = applyServerFieldErrors(this.form, toApiError(error));
        this.serverError.set(describeApiError(error));
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
    this.cancelled.emit();
  }

  /** Create: trimmed values, blank supplier id left out. Edit: only the changed fields. */
  private buildRequest(): Observable<SellerAccount> | null {
    const displayName = this.form.controls.displayName.value.trim();
    const supplierId = this.form.controls.meeshoSupplierId.value.trim() || null;
    const account = this.account();
    if (account === null) {
      return this.api.create(this.workspaceId(), {
        displayName,
        ...(supplierId ? { meeshoSupplierId: supplierId } : {}),
      });
    }
    const changes: UpdateSellerAccountRequest = {};
    if (displayName !== account.displayName) {
      changes.displayName = displayName;
    }
    if (supplierId !== account.meeshoSupplierId) {
      changes.meeshoSupplierId = supplierId;
    }
    return Object.keys(changes).length > 0 ? this.api.update(account.id, changes) : null;
  }

  private focusControl(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formcontrolname="${name}"]`)?.focus();
  }
}

/** Letters, digits, `_` and `-` only (checked on the trimmed value; blank is allowed). */
function supplierIdFormat(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  return value.length === 0 || MEESHO_SUPPLIER_ID_PATTERN.test(value) ? null : { format: true };
}
