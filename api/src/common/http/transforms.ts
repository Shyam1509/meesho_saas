import type { TransformFnParams } from 'class-transformer';
import {
  collapseWhitespace,
  stripFormatChars,
} from '../../imports/parsing/normalizers';

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

/**
 * @Transform for identifiers and names typed by a user that must equal what the importer stores (SKU,
 * catalog id, product name): Unicode format characters removed, whitespace collapsed and trimmed, exactly
 * like the importer's normalizeText. Non-strings pass through for the validators to reject.
 */
export function cleanText({ value }: TransformFnParams): unknown {
  return typeof value === 'string'
    ? collapseWhitespace(stripFormatChars(value))
    : value;
}

/** cleanText for a nullable field: blank text becomes null ("no value"). */
export function cleanNullableText(params: TransformFnParams): unknown {
  const cleaned = cleanText(params);
  return cleaned === '' ? null : cleaned;
}

/**
 * Free text for a nullable field (notes, descriptions): Unicode format characters (zero-width space,
 * bidi controls, soft hyphen, …) removed, then trimmed; blank becomes null, so text made only of invisible
 * characters counts as no text.
 */
export function trimNullableText({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = stripFormatChars(value).trim();
  return trimmed === '' ? null : trimmed;
}
