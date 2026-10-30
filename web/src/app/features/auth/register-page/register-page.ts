import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import { AuthStateService } from '../../../core/auth/auth-state.service';
import {
  DEFAULT_SIGNED_IN_URL,
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RegisterRequest,
} from '../../../core/auth/auth.models';
import { safeReturnUrl } from '../../../core/auth/return-url';
import {
  applyServerFieldErrors,
  emailTrimmed,
  errorMessage,
  focusFirstInvalidControl,
  maxLengthTrimmed,
  requiredTrimmed,
  showError,
} from '../../../shared/forms/form-helpers';
import { AuthLayout } from '../auth-layout';

/**
 * `/register` (only while the API allows registration): creates the user, their first workspace
 * (they become its owner) and a session, then continues to the sanitised `returnUrl`.
 */
@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register-page.html',
})
export class RegisterPage {
  /** The `returnUrl` query param (component input binding); only used once sanitised. */
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  /** Controls in on-screen order (the first invalid one gets focus). */
  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: ['', [maxLengthTrimmed(NAME_MAX_LENGTH)]],
    email: ['', [requiredTrimmed, emailTrimmed, maxLengthTrimmed(EMAIL_MAX_LENGTH)]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(PASSWORD_MIN_LENGTH),
        Validators.maxLength(PASSWORD_MAX_LENGTH),
      ],
    ],
    // Client-side only: there is no password reset yet, so a typo would lock the user out.
    confirmPassword: ['', [Validators.required, matchesPassword]],
    workspaceName: ['', [maxLengthTrimmed(NAME_MAX_LENGTH)]],
  });

  protected readonly messages = {
    displayName: { maxlength: `Your name must be at most ${NAME_MAX_LENGTH} characters.` },
    email: {
      required: 'Enter your email address.',
      email: 'Enter a valid email address, like name@example.com.',
      maxlength: `Email must be at most ${EMAIL_MAX_LENGTH} characters.`,
    },
    password: {
      required: 'Choose a password.',
      minlength: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      maxlength: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    },
    confirmPassword: {
      required: 'Enter the password again.',
      mismatch: 'The passwords do not match.',
    },
    workspaceName: {
      maxlength: `Workspace name must be at most ${NAME_MAX_LENGTH} characters.`,
    },
  } as const;

  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  protected readonly passwordMaxLength = PASSWORD_MAX_LENGTH;
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly safeReturn = computed(() => safeReturnUrl(this.returnUrl()));
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  constructor() {
    // Re-check the confirmation whenever the password itself changes.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.confirmPassword.updateValueAndValidity());
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

    this.submitting.set(true);
    this.auth
      .register(this.toRequest())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          void this.router
            .navigateByUrl(this.safeReturn() ?? DEFAULT_SIGNED_IN_URL)
            .finally(() => this.submitting.set(false));
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          applyServerFieldErrors(this.form, toApiError(error));
          // 403 (registration closed), 409 (email taken) and 429 messages come from the API.
          this.serverError.set(describeApiError(error));
          afterNextRender(() => this.errorAlert()?.nativeElement.focus(), {
            injector: this.injector,
          });
        },
      });
  }

  /** Trimmed values; blank optional fields are left out so the API applies its defaults. */
  private toRequest(): RegisterRequest {
    const { displayName, email, password, workspaceName } = this.form.getRawValue();
    const request: RegisterRequest = { email: email.trim(), password };
    if (displayName.trim()) {
      request.displayName = displayName.trim();
    }
    if (workspaceName.trim()) {
      request.workspaceName = workspaceName.trim();
    }
    return request;
  }
}

/** `confirmPassword` must equal its sibling `password`. */
function matchesPassword(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('password')?.value as string | undefined;
  return control.value && password !== undefined && control.value !== password
    ? { mismatch: true }
    : null;
}
