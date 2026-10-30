import type { FieldSpec, SheetProfile } from '../profiles/meesho-profiles';
import {
  collapseWhitespace,
  normalizeHeader,
  stripFormatChars,
  type RawCell,
} from './normalizers';

/** One mapped column: field → 0-based column index and the header text as written in the file. */
export interface MappedColumn {
  field: FieldSpec;
  index: number;
  header: string;
}

export interface HeaderMatch {
  columns: MappedColumn[];
  /** Header names (as written) that matched a field. */
  recognised: string[];
  /** Non-blank header names that matched nothing (their cells are never read or stored). */
  ignored: string[];
  missingRequired: FieldSpec[];
  missingOptional: FieldSpec[];
  /** Fields that two or more columns matched: the file is ambiguous. */
  duplicates: { field: FieldSpec; headers: string[] }[];
}

/** Header names kept (in messages, row errors, the preview) are cut to this many characters. */
export const MAX_HEADER_NAME_LENGTH = 100;

/** A header cell as text: format characters removed, whitespace collapsed, at most 100 characters. */
function headerText(cell: RawCell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return '';
  const text = collapseWhitespace(stripFormatChars(String(cell)));
  const chars = [...text];
  return chars.length > MAX_HEADER_NAME_LENGTH
    ? `${chars.slice(0, MAX_HEADER_NAME_LENGTH - 1).join('')}…`
    : text;
}

/** Which field (if any) a normalised header belongs to: an exact alias beats a prefix. */
export function fieldForHeader(
  normalized: string,
  fields: readonly FieldSpec[],
): FieldSpec | undefined {
  if (normalized === '') return undefined;
  const exact = fields.find((f) =>
    f.aliases.some((alias) => normalizeHeader(alias) === normalized),
  );
  if (exact) return exact;
  return fields.find(
    (f) =>
      (f.prefixes ?? []).some((p) => normalized.startsWith(p)) &&
      !(f.excludePrefixes ?? []).some((p) => normalized.startsWith(p)),
  );
}

/** Maps a header row onto a profile's fields. */
export function matchHeaders(
  cells: readonly (RawCell | undefined)[],
  fields: readonly FieldSpec[],
): HeaderMatch {
  const byField = new Map<string, MappedColumn[]>();
  const ignored: string[] = [];
  cells.forEach((cell, index) => {
    const header = headerText(cell);
    if (header === '') return;
    const field = fieldForHeader(normalizeHeader(header), fields);
    if (!field) {
      ignored.push(header);
      return;
    }
    const list = byField.get(field.key) ?? [];
    list.push({ field, index, header });
    byField.set(field.key, list);
  });

  const columns: MappedColumn[] = [];
  const duplicates: HeaderMatch['duplicates'] = [];
  for (const list of byField.values()) {
    if (list.length > 1) {
      duplicates.push({
        field: list[0].field,
        headers: list.map((c) => c.header),
      });
    }
    columns.push(list[0]);
  }
  columns.sort((a, b) => a.index - b.index);
  const found = new Set(byField.keys());
  return {
    columns,
    recognised: columns.map((c) => c.header),
    ignored,
    missingRequired: fields.filter((f) => f.required && !found.has(f.key)),
    missingOptional: fields.filter((f) => !f.required && !found.has(f.key)),
    duplicates,
  };
}

/** "Missing required column ..." / "Columns ... both match ..." reasons for a header match. */
export function headerProblems(match: HeaderMatch): string[] {
  const reasons = match.missingRequired.map((f) => {
    const others = f.aliases.filter((a) => a !== f.label);
    const also =
      others.length > 0
        ? ` (also accepted: ${others.map((a) => `"${a}"`).join(', ')})`
        : '';
    return `Missing required column "${f.label}"${also}`;
  });
  for (const { field, headers } of match.duplicates) {
    reasons.push(
      `Columns ${headers.map((h) => `"${h}"`).join(' and ')} ${headers.length === 2 ? 'both' : 'all'} match "${field.label}"; keep only one`,
    );
  }
  return reasons;
}

export interface HeaderRowCandidate {
  rowNumber: number;
  cells: readonly RawCell[];
}

/**
 * The header row of a sheet: the first candidate row that has every required column. When none has,
 * returns the candidate with the most required columns (for the error message), or null when there are
 * no candidates.
 */
export function findHeaderRow(
  candidates: readonly HeaderRowCandidate[],
  fields: readonly FieldSpec[],
): { rowNumber: number; match: HeaderMatch; complete: boolean } | null {
  let best: { rowNumber: number; match: HeaderMatch } | null = null;
  for (const candidate of candidates) {
    const match = matchHeaders(candidate.cells, fields);
    if (match.missingRequired.length === 0) {
      return { rowNumber: candidate.rowNumber, match, complete: true };
    }
    if (
      !best ||
      match.missingRequired.length < best.match.missingRequired.length
    ) {
      best = { rowNumber: candidate.rowNumber, match };
    }
  }
  return best ? { ...best, complete: false } : null;
}

/** The settlement sheet profile a sheet name belongs to (compared like headers), if any. */
export function profileForSheet(
  sheetName: string,
  profiles: readonly SheetProfile[],
): SheetProfile | undefined {
  const normalized = normalizeHeader(sheetName);
  return profiles.find((p) =>
    p.names.some((n) => normalizeHeader(n) === normalized),
  );
}
