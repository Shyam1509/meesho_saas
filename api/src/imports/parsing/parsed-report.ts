import type {
  ImportReportType,
  ImportRowError,
  ImportSheetSummary,
} from '../../database/models';

/** Normalised values of one source row, keyed by profile field key. Mapped columns only. */
export type RowValues = Record<string, string | null>;

export interface ParsedRow {
  /** '' for CSV files. */
  sheetName: string;
  /** Row number as the user sees it in the file (header counted). */
  rowNumber: number;
  /** Empty = valid. */
  errors: ImportRowError[];
  values: RowValues;
  /**
   * import_rows.row_hash: settlement rows = entry fingerprint v1 (valid rows only); order rows = sha256
   * of the normalised values.
   */
  rowHash: string | null;
}

/** Result of parsing one uploaded file (no database access involved). */
export interface ParsedReport {
  reportType: ImportReportType;
  sheets: ImportSheetSummary[];
  /** Non-blank data rows in file order (sheet by sheet). */
  rows: ParsedRow[];
  /** 'YYYY-MM-DD': orders → order dates; settlements → payment dates (valid rows), or null. */
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ParseLimits {
  /** Most non-blank data rows in the file (all sheets). */
  maxRows: number;
}

/** Earliest and latest of a set of 'YYYY-MM-DD' strings (they sort lexically). */
export function dateRange(dates: (string | null | undefined)[]): {
  start: string | null;
  end: string | null;
} {
  const present = dates
    .filter((d): d is string => typeof d === 'string')
    .sort();
  return {
    start: present[0] ?? null,
    end: present[present.length - 1] ?? null,
  };
}

export const tooManyRowsReason = (max: number) =>
  `The file has more than ${max} data rows: split it into smaller date ranges`;

/** Rows / lines a file may physically contain: the data-row cap plus room for blank rows and headers. */
export const physicalLimit = (maxRows: number) => maxRows + 1000;

export const tooManyLinesReason = (limit: number) =>
  `The file has more than ${limit} rows or lines (blank ones included): split it into smaller date ranges`;

/** Preview lists of column names: at most this many names, each at most this many characters. */
export const MAX_LISTED_NAMES = 100;
export const MAX_LISTED_NAME_LENGTH = 100;

/** Caps a list of column names for the preview: 100 names × 100 characters, then "and N more". */
export function capNames(names: readonly string[]): string[] {
  const cut = (name: string) => {
    const chars = [...name];
    return chars.length > MAX_LISTED_NAME_LENGTH
      ? `${chars.slice(0, MAX_LISTED_NAME_LENGTH - 1).join('')}…`
      : name;
  };
  const listed = names.slice(0, MAX_LISTED_NAMES).map(cut);
  if (names.length > MAX_LISTED_NAMES) {
    listed.push(`and ${names.length - MAX_LISTED_NAMES} more`);
  }
  return listed;
}

/** Most columns a row may use: a value beyond column 200 rejects the file (CSV and XLSX). */
export const MAX_COLUMNS = 200;

export const tooManyColumnsReason = (max: number) =>
  `A row uses more than ${max} columns: this does not look like a Meesho report`;
