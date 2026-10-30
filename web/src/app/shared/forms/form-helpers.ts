import {
  AbstractControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { ApiError } from '../../core/api/api-error';

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
