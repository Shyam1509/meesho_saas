import { CsvError, parse } from 'csv-parse/sync';
import { FileRejectedError } from './file-rejected.error';
import { MAX_COLUMNS, tooManyColumnsReason } from './parsed-report';

const NOT_UTF8 =
  'The file is not UTF-8 text: in Excel use "Save As → CSV UTF-8 (Comma delimited)"';

/** Longest record (characters) csv-parse buffers; anything longer is broken quoting, not a row. */
export const CSV_MAX_RECORD_SIZE = 64 * 1024;

/**
 * Decodes CSV bytes as strict UTF-8 (invalid byte sequences reject the file instead of turning into
 * U+FFFD) and drops a leading byte-order mark. NUL characters mean it is not a text file.
 */
export function decodeCsv(buffer: Buffer): string {
  let text: string;
  try {
    // TextDecoder strips a leading UTF-8 BOM by default (ignoreBOM: false).
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw FileRejectedError.of('file', NOT_UTF8);
  }
  if (text.includes('\u0000')) {
    throw FileRejectedError.of('file', 'The file is not a text (CSV) file');
  }
  return text;
}

/**
 * Physical lines of a text: LF, CRLF and lone CR each end one line; a last line without a terminator
 * counts too. Blank lines count, and a line break inside a quoted field counts as a line.
 */
export function countPhysicalLines(text: string): number {
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) lines += 1;
    else if (code === 13 && text.charCodeAt(i + 1) !== 10) lines += 1;
  }
  const last = text.charCodeAt(text.length - 1);
  if (text.length > 0 && last !== 10 && last !== 13) lines += 1;
  return lines;
}

/**
 * Streams RFC 4180 records (comma-separated, double-quote quoting, quotes doubled inside quoted fields,
 * line breaks allowed inside quotes; CRLF or LF) to `visit` one at a time; csv-parse keeps none of them.
 * Record i is spreadsheet row i + 1, and a blank line is an empty record. Ragged rows are allowed. A
 * record over 64 KB, a record with more than 200 fields (even empty ones) or malformed quoting rejects
 * the file. Errors thrown by `visit` propagate unchanged.
 */
export function forEachCsvRecord(
  text: string,
  visit: (record: string[], index: number) => void,
): void {
  let index = 0;
  try {
    parse(text, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      max_record_size: CSV_MAX_RECORD_SIZE,
      on_record: (record: string[]) => {
        if (record.length > MAX_COLUMNS) {
          throw FileRejectedError.of('file', tooManyColumnsReason(MAX_COLUMNS));
        }
        visit(record, index++);
        return null;
      },
    });
  } catch (err) {
    if (err instanceof CsvError) {
      const lines = err.lines;
      const line = typeof lines === 'number' ? ` near line ${lines}` : '';
      throw FileRejectedError.of(
        'file',
        err.code === 'CSV_MAX_RECORD_SIZE'
          ? `A CSV row is longer than ${CSV_MAX_RECORD_SIZE / 1024} KB${line} (check for an unclosed double quote)`
          : `The CSV file is malformed${line} (check for an unclosed or stray double quote)`,
      );
    }
    throw err;
  }
}

/** All records of a (small) CSV text, for tests and diagnostics. */
export function readCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  forEachCsvRecord(text, (record) => records.push(record));
  return records;
}
