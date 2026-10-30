import { UniqueConstraintError } from 'sequelize';
import type { ValidationErrorDetailDto } from './error-response.dto';

/**
 * Field details for a MySQL duplicate-key error, given which unique key backs which API field. Used as
 * the race-safe fallback behind explicit duplicate checks. Returns null for any other error, or when no
 * listed key is involved. The duplicated value is never copied into the result.
 */
export function uniqueConflictDetails(
  err: unknown,
  keyToField: Readonly<Record<string, { field: string; reason: string }>>,
): ValidationErrorDetailDto[] | null {
  if (!(err instanceof UniqueConstraintError)) return null;
  // Sequelize puts the key name in `fields` when the model does not declare it; sqlMessage always names it.
  const keys = Object.keys(err.fields ?? {});
  const parent = err.parent as { sqlMessage?: unknown } | undefined;
  const sqlMessage =
    typeof parent?.sqlMessage === 'string' ? parent.sqlMessage : '';
  const details = Object.entries(keyToField)
    .filter(([key]) => keys.includes(key) || sqlMessage.includes(`.${key}'`))
    .map(([, { field, reason }]) => ({ field, reasons: [reason] }));
  return details.length > 0 ? details : null;
}
