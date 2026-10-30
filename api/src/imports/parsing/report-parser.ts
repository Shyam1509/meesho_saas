import { decodeCsv } from './csv-reader';
import { detectReportType } from './file-type';
import { parseOrdersCsv } from './orders-parser';
import {
  physicalLimit,
  tooManyLinesReason,
  type ParseLimits,
  type ParsedReport,
} from './parsed-report';
import {
  SettlementWorkbookParser,
  type SheetSession,
} from './settlement-parser';
import {
  readWorkbookStructure,
  type WorkbookSheetRef,
} from './workbook-structure';
import { streamWorkbookRows } from './xlsx-reader';
import { inspectZip, WORKBOOK_ZIP_LIMITS } from './zip-guard';

/**
 * Settlement workbook: zip-bomb guard (validated entries) → sheet names from workbook.xml → only the
 * recognised sheets are streamed row by row, counted as they arrive (all streamed rows ≤ IMPORT_MAX_ROWS +
 * 1000, non-blank data rows ≤ IMPORT_MAX_ROWS) and parsed on the fly.
 */
async function parseWorkbook(
  buffer: Buffer,
  limits: ParseLimits,
): Promise<ParsedReport> {
  const entries = inspectZip(buffer, WORKBOOK_ZIP_LIMITS);
  const structure = readWorkbookStructure(buffer, entries);
  const parser = new SettlementWorkbookParser(limits);
  const wanted: WorkbookSheetRef[] = [];
  const sessions: SheetSession[] = [];
  for (const sheet of structure.sheets) {
    const session = parser.addSheet(sheet.name);
    if (session) {
      wanted.push(sheet);
      sessions.push(session);
    }
  }
  parser.assertRecognised();
  const rowLimit = physicalLimit(limits.maxRows);
  await streamWorkbookRows(buffer, structure, wanted, (i) => sessions[i], {
    maxPhysicalRows: rowLimit,
    tooManyRowsReason: tooManyLinesReason(rowLimit),
  });
  return parser.finish();
}

/**
 * Upload → parsed report, without touching the database:
 * detect type (extension + content) → CSV: strict UTF-8 → line-count limit → streamed RFC 4180 records →
 * orders profile; XLSX: see parseWorkbook. File-level problems throw FileRejectedError.
 */
export async function parseReport(
  filename: string,
  buffer: Buffer,
  limits: ParseLimits,
): Promise<ParsedReport> {
  const reportType = detectReportType(filename, buffer);
  if (reportType === 'orders_csv') {
    return parseOrdersCsv(decodeCsv(buffer), limits);
  }
  return parseWorkbook(buffer, limits);
}
