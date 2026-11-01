/**
 * CSV writing for the Milestone 7 exports: RFC 4180 fields, CRLF line ends, a UTF-8 BOM first (so Excel
 * reads UTF-8), and a CSV-injection guard on TEXT cells. Numbers are written exactly as MySQL returned them
 * (dot decimal, no ₹, no grouping, a negative keeps its "-") and are never touched by the guard.
 */

export const CSV_BOM = '﻿';
export const CSV_EOL = '\r\n';

/**
 * text: any string (guarded); number: an amount / count / id (`-?digits[.digits]`), written as is.
 * A "number" value that does not look like one is treated as text (and guarded), never trusted.
 */
export type CsvCellKind = 'text' | 'number';
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  kind: CsvCellKind;
  value: (row: Row) => CsvValue;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Text a spreadsheet may run as a formula: starting with TAB or CR, or with = + - @ (or their full-width
 * forms U+FF1D U+FF0B U+FF0D U+FF20) after any leading spaces / TAB / CR / LF (spreadsheets trim those).
 */
const FORMULA_START = /^(?:[\t\r]|[ \t\r\n]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;

const NEEDS_QUOTES = /[",\r\n]/;

/** RFC 4180: a field with a quote, comma or line break is quoted, quotes doubled. */
function quote(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A text cell: "'" in front of a formula-looking start, then quoted when needed. */
export function textCell(value: string): string {
  return quote(FORMULA_START.test(value) ? `'${value}` : value);
}

/** One cell; null / undefined → empty (missing is never written as 0). */
export function csvCell(value: CsvValue, kind: CsvCellKind): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = typeof value === 'number' ? String(value) : value;
  if (kind === 'number' && PLAIN_NUMBER.test(text)) return text;
  return textCell(text);
}

export function csvLine(cells: readonly string[]): string {
  return cells.join(',') + CSV_EOL;
}

export function csvHeader<Row>(columns: readonly CsvColumn<Row>[]): string {
  return csvLine(columns.map((c) => textCell(c.header)));
}

export function csvRow<Row>(
  columns: readonly CsvColumn<Row>[],
  row: Row,
): string {
  return csvLine(columns.map((c) => csvCell(c.value(row), c.kind)));
}

const MAX_NAME_PART = 60;

/**
 * An account / workspace name as an ASCII filename part: accents dropped, every run of other characters
 * → "-", trimmed, at most 60 characters; "export" when nothing is left (e.g. a name in another script).
 */
export function filenamePart(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_PART)
    .replace(/-+$/, '');
  return ascii === '' ? 'export' : ascii;
}

/**
 * The same name keeping letters and digits of every script (for the RFC 5987 `filename*`): NFC, every run
 * of other characters (spaces, punctuation, quotes, slashes, controls, bidi marks) → "-", trimmed, at most 60
 * code points; "export" when nothing is left.
 */
export function unicodeFilenamePart(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const limited = [...cleaned]
    .slice(0, MAX_NAME_PART)
    .join('')
    .replace(/-+$/, '');
  return limited === '' ? 'export' : limited;
}

/** `-<type>-<from>_<to>.csv`; with only one bound `…-from-<from>.csv` / `…-to-<to>.csv`, with none `-<type>.csv`. */
function filenameSuffix(
  type: string,
  range: { from?: string; to?: string },
): string {
  const date = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : 'date');
  if (range.from && range.to) {
    return `-${type}-${date(range.from)}_${date(range.to)}.csv`;
  }
  if (range.from) return `-${type}-from-${date(range.from)}.csv`;
  if (range.to) return `-${type}-to-${date(range.to)}.csv`;
  return `-${type}.csv`;
}

/**
 * `<name>-<type>-<from>_<to>.csv` in ASCII. Dates are validated YYYY-MM-DD, so the result is always
 * [A-Za-z0-9._-] only.
 */
export function csvFilename(
  name: string,
  type: string,
  range: { from?: string; to?: string },
): string {
  return `${filenamePart(name)}${filenameSuffix(type, range)}`;
}

/** RFC 5987 value-chars: percent-encode everything but ALPHA / DIGIT / ! # $ & + - . ^ _ ` | ~ . */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The Content-Disposition of a CSV download: an ASCII `filename="…"` for every client and an RFC 5987
 * `filename*=UTF-8''…` that keeps the name's own letters (e.g. a Hindi account name) for clients that read it.
 */
export function csvContentDisposition(
  name: string,
  type: string,
  range: { from?: string; to?: string },
): string {
  const ascii = csvFilename(name, type, range);
  const unicode = `${unicodeFilenamePart(name)}${filenameSuffix(type, range)}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(unicode)}`;
}
