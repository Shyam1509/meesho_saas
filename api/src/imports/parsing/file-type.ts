import { extname } from 'node:path';
import type { ImportReportType } from '../../database/models';
import { FileRejectedError } from './file-rejected.error';

/** Local file header signature of a ZIP archive (every .xlsx is one). */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const UNSUPPORTED_TYPE_REASON =
  'Unsupported file type: upload the orders report as .csv or the settlement workbook as .xlsx';

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

/**
 * Report type from the extension AND the content: `.csv` that is not a ZIP → orders_csv (its encoding is
 * checked by the CSV reader); `.xlsx` that starts with the ZIP signature → settlement_xlsx. Anything else,
 * an empty file, or content that contradicts the extension → FileRejectedError.
 */
export function detectReportType(
  filename: string,
  buffer: Buffer,
): ImportReportType {
  if (buffer.length === 0)
    throw FileRejectedError.of('file', 'The file is empty');
  const extension = extname(filename).toLowerCase();
  if (extension === '.csv') {
    if (isZip(buffer)) {
      throw FileRejectedError.of(
        'file',
        'This .csv file is actually a ZIP/Excel file: export the orders report as CSV',
      );
    }
    return 'orders_csv';
  }
  if (extension === '.xlsx') {
    if (!isZip(buffer)) {
      throw FileRejectedError.of(
        'file',
        'This is not a valid .xlsx workbook (old .xls files are not supported: save as .xlsx)',
      );
    }
    return 'settlement_xlsx';
  }
  throw FileRejectedError.of('file', UNSUPPORTED_TYPE_REASON);
}

/**
 * The client's file name as stored and shown: last path segment only, control and format characters
 * (zero-width, bidi overrides such as U+202E) removed, whitespace collapsed, at most 255 characters.
 * Falls back to a generic name.
 */
export function cleanFilename(
  original: string,
  reportType: ImportReportType,
): string {
  const lastSegment = original.split(/[\\/]/).pop() ?? '';
  const cleaned = lastSegment
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...cleaned];
  const name = chars.length > 255 ? chars.slice(0, 255).join('') : cleaned;
  if (name !== '') return name;
  return reportType === 'orders_csv' ? 'orders.csv' : 'settlement.xlsx';
}
