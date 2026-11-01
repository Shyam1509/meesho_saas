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
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import { AuthStateService } from '../../../core/auth/auth-state.service';
import {
  DEFAULT_SIGNED_IN_URL,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
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

/** `/login`: email + password sign-in, then back to the (sanitised) `returnUrl`. */
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-page.html',
})
export class LoginPage {
  /** The `returnUrl` query param (component input binding); only used once sanitised. */
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [requiredTrimmed, emailTrimmed, maxLengthTrimmed(EMAIL_MAX_LENGTH)]],
    // Sign-in checks presence and the 128 cap only: the 12-character minimum is a sign-up rule,
    // and a password created another way may be shorter.
    password: ['', [Validators.required, Validators.maxLength(PASSWORD_MAX_LENGTH)]],
  });

  protected readonly messages = {
    email: {
      required: 'Enter your email address.',
      email: 'Enter a valid email address, like name@example.com.',
      maxlength: `Email must be at most ${EMAIL_MAX_LENGTH} characters.`,
    },
    password: {
      required: 'Enter your password.',
      maxlength: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    },
  } as const;

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly registrationEnabled = this.auth.registrationEnabled;
  protected readonly sessionCheckError = this.auth.sessionCheckError;
  /** The session ended while the app was in use (the 401 interceptor sent them here). */
  protected readonly sessionExpired = this.auth.sessionExpired;
  protected readonly safeReturn = computed(() => safeReturnUrl(this.returnUrl()));
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  constructor() {
    // Decides whether to offer the "Create an account" link.
    void this.auth.loadConfig();
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

    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.auth
      .login({ email: email.trim(), password })
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
          // 401/403/409/429 messages come from the API and are deliberately generic.
          this.serverError.set(describeApiError(error));
          afterNextRender(() => this.errorAlert()?.nativeElement.focus(), {
            injector: this.injector,
          });
        },
      });
  }
}
