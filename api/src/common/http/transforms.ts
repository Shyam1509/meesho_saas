import type { TransformFnParams } from 'class-transformer';

/** @Transform helper: trims strings; other values pass through for the validators to reject. */
export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** @Transform helper for emails: trim + lower-case (stored and looked up in this form). */
export function normalizeEmail({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** Display/workspace names and other short labels: 1–120 characters after trimming. */
export const NAME_MAX_LENGTH = 120;
