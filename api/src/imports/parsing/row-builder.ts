import type { ImportRowError } from '../../database/models';
import type { FieldSpec } from '../profiles/meesho-profiles';
import type { MappedColumn } from './header-matcher';
import {
  displayRaw,
  normalizeDate,
  normalizeDecimal,
  normalizeId,
  normalizeQuantity,
  normalizeStatus,
  normalizeText,
  REASONS,
  stripFormatChars,
  type Normalized,
  type RawCell,
} from './normalizers';
import type { RowValues } from './parsed-report';

export function normalizeField(
  field: FieldSpec,
  raw: RawCell,
): Normalized<string> {
  switch (field.kind) {
    case 'id':
      return normalizeId(raw, field.maxLength ?? 64);
    case 'text':
      return normalizeText(raw, field.maxLength ?? 255);
    case 'status':
      return normalizeStatus(raw);
    case 'date':
      return normalizeDate(raw);
    case 'decimal':
      return normalizeDecimal(raw);
    case 'quantity':
      return normalizeQuantity(raw);
  }
}

function isBlankCell(raw: RawCell | undefined): boolean {
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && stripFormatChars(raw).trim() === '')
  );
}

/** True when every MAPPED cell of the row is empty: such rows are skipped and not counted. */
export function isBlankRow(
  cells: readonly (RawCell | undefined)[],
  columns: readonly MappedColumn[],
): boolean {
  return columns.every((c) => isBlankCell(cells[c.index]));
}

/** `"Order Date" is not a valid date ...`: the column name as written in the file, never the value. */
function reasonFor(column: MappedColumn, reason: string): string {
  return `"${column.header}" ${reason}`;
}

/**
 * Normalises the mapped cells of one row. Values hold every mapped field (null = blank); an invalid cell
 * keeps its trimmed raw text so the user can find it. Required fields that are blank are errors.
 */
export function buildRow(
  cells: readonly (RawCell | undefined)[],
  columns: readonly MappedColumn[],
): { values: RowValues; errors: ImportRowError[] } {
  const values: RowValues = {};
  const errors: ImportRowError[] = [];
  for (const column of columns) {
    const raw = cells[column.index] ?? null;
    const result = normalizeField(column.field, raw);
    if (!result.ok) {
      values[column.field.key] = displayRaw(raw);
      errors.push({
        field: column.field.key,
        reason: reasonFor(column, result.reason),
      });
      continue;
    }
    values[column.field.key] = result.value;
    if (
      result.value === null &&
      column.field.required &&
      !column.field.blankAllowed
    ) {
      errors.push({
        field: column.field.key,
        reason: reasonFor(column, REASONS.required),
      });
    }
  }
  return { values, errors };
}
