import {
  AbstractControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { ApiError } from '../../core/api/api-error';
import { isDateOnly } from '../url-state/url-state';

/** `required`, ignoring surrounding whitespace (the value is trimmed before it is sent). */
export const requiredTrimmed: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  String(control.value ?? '').trim().length === 0 ? { required: true } : null;

/** `maxlength` on the trimmed value. */
export function maxLengthTrimmed(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const length = String(control.value ?? '').trim().length;
    return length > max ? { maxlength: { requiredLength: max, actualLength: length } } : null;
  };
}

/** Angular's email check on the trimmed value; empty passes (pair it with `requiredTrimmed`). */
export const emailTrimmed: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  return value.length === 0 ? null : Validators.email({ value } as AbstractControl);
};

/** A real calendar day written `YYYY-MM-DD` (`date` error); empty passes. */
export const dateOnly: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  return value.length === 0 || isDateOnly(value) ? null : { date: true };
};

/**
 * A valid day no later than `max()` (`YYYY-MM-DD`, read at validation time so "today" stays
 * current): `after` error. Empty or malformed values pass (see {@link dateOnly}).
 */
export function notAfter(max: () => string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    const limit = max();
    return isDateOnly(value) && value > limit ? { after: { max: limit } } : null;
  };
}

/**
 * A rupee amount typed as text (trimmed): digits with at most `maxDecimals` decimals, no sign and
 * no leading zeros such as "007.5", as the API requires (`format` error); above zero when
 * `positive` (`positive` error); below `limit` (`limit` error). Empty passes (pair it with
 * `requiredTrimmed`).
 */
export function decimalAmount(options: {
  maxDecimals: number;
  limit: number;
  positive?: boolean;
}): ValidatorFn {
  const pattern = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${options.maxDecimals}})?$`);
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    if (value.length === 0) {
      return null;
    }
    if (!pattern.test(value)) {
      return { format: true };
    }
    const amount = Number(value);
    if (options.positive && amount <= 0) {
      return { positive: true };
    }
    return amount >= options.limit ? { limit: { limit: options.limit } } : null;
  };
}

/**
 * Puts the API's per-field reasons (`details`) on the matching controls as a `server` error, which
 * the control drops again as soon as the user edits it. Returns the names of the controls hit.
 */
export function applyServerFieldErrors(form: FormGroup, error: ApiError): string[] {
  const hit: string[] = [];
  for (const [name, control] of Object.entries(form.controls)) {
    const reasons = error.reasonsFor(name);
    if (reasons.length > 0) {
      control.setErrors({ ...control.errors, server: reasons.join(' ') });
      control.markAsTouched();
      hit.push(name);
    }
  }
  return hit;
}

/**
 * Focuses the first invalid control, in the group's declaration order (keep it the same as the
 * order on screen). Returns false when every control is valid.
 */
export function focusFirstInvalidControl(root: HTMLElement, form: FormGroup): boolean {
  const name = Object.keys(form.controls).find((key) => form.controls[key].invalid);
  if (name === undefined) {
    return false;
  }
  root.querySelector<HTMLElement>(`[formcontrolname="${name}"]`)?.focus();
  return true;
}

/** True when the control's error should be shown (invalid and touched, e.g. after a submit). */
export function showError(control: AbstractControl): boolean {
  return control.invalid && control.touched;
}

/**
 * The message for the control's first failing rule, in the order `messages` lists them; then the
 * API's reasons (`server`). `null` when the control is valid.
 */
export function errorMessage(
  control: AbstractControl,
  messages: Readonly<Record<string, string>>,
): string | null {
  const errors = control.errors;
  if (!errors) {
    return null;
  }
  const key = Object.keys(messages).find((k) => errors[k] !== undefined && errors[k] !== null);
  if (key !== undefined) {
    return messages[key];
  }
  return typeof errors['server'] === 'string' ? errors['server'] : null;
}
