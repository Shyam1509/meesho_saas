import { ORDERS_CSV_FIELDS } from '../profiles/meesho-profiles';
import { countPhysicalLines, forEachCsvRecord } from './csv-reader';
import { valuesHash } from './fingerprint';
import { FileRejectedError } from './file-rejected.error';
import {
  headerProblems,
  matchHeaders,
  type HeaderMatch,
} from './header-matcher';
import {
  capNames,
  dateRange,
  physicalLimit,
  tooManyLinesReason,
  tooManyRowsReason,
  type ParseLimits,
  type ParsedReport,
  type ParsedRow,
} from './parsed-report';
import { buildRow, isBlankRow } from './row-builder';

/**
 * Orders CSV text → rows. Before parsing, a file with more physical lines than IMPORT_MAX_ROWS + 1000
 * (blank lines included) is rejected; then records are streamed one at a time, so only the mapped values
 * of kept rows stay in memory. The header is the first record; it must contain every required column, and
 * no field may be matched by two columns (otherwise the file is rejected). Blank rows (all mapped cells
 * empty) are skipped and not counted. A Sub Order No repeated within the file makes the later rows errors.
 */
export function parseOrdersCsv(
  text: string,
  limits: ParseLimits,
): ParsedReport {
  const lineLimit = physicalLimit(limits.maxRows);
  if (countPhysicalLines(text) > lineLimit) {
    throw FileRejectedError.of('file', tooManyLinesReason(lineLimit));
  }

  let header: HeaderMatch | null = null;
  let subOrderHeader = 'Sub Order No';
  const rows: ParsedRow[] = [];
  const firstRowOfSubOrder = new Map<string, number>();

  forEachCsvRecord(text, (cells, index) => {
    if (index === 0) {
      if (cells.every((cell) => cell.trim() === '')) {
        throw FileRejectedError.of(
          'file',
          'The first row must be the header row (column names)',
        );
      }
      const match = matchHeaders(cells, ORDERS_CSV_FIELDS);
      const problems = headerProblems(match);
      if (problems.length > 0) {
        throw FileRejectedError.of('columns', ...problems);
      }
      subOrderHeader =
        match.columns.find((c) => c.field.key === 'subOrderNo')?.header ??
        subOrderHeader;
      header = match;
      return;
    }
    const columns = header?.columns ?? [];
    if (isBlankRow(cells, columns)) return;
    if (rows.length >= limits.maxRows) {
      throw FileRejectedError.of('file', tooManyRowsReason(limits.maxRows));
    }
    const rowNumber = index + 1;
    const { values, errors } = buildRow(cells, columns);
    const subOrderNo = values.subOrderNo;
    if (subOrderNo && !errors.some((e) => e.field === 'subOrderNo')) {
      const first = firstRowOfSubOrder.get(subOrderNo);
      if (first === undefined) {
        firstRowOfSubOrder.set(subOrderNo, rowNumber);
      } else {
        errors.push({
          field: 'subOrderNo',
          reason: `"${subOrderHeader}" is also on row ${first}: each sub-order may appear once per file`,
        });
      }
    }
    rows.push({
      sheetName: '',
      rowNumber,
      errors,
      values,
      rowHash: valuesHash(values),
    });
  });

  // Assigned inside the callback; TypeScript cannot see that.
  const found = header as HeaderMatch | null;
  if (!found) throw FileRejectedError.of('file', 'The file is empty');
  if (rows.length === 0) {
    throw FileRejectedError.of('file', 'The file has no data rows');
  }
  const valid = rows.filter((r) => r.errors.length === 0);
  const period = dateRange(valid.map((r) => r.values.orderDate));
  return {
    reportType: 'orders_csv',
    sheets: [
      {
        name: '',
        entryType: null,
        ignored: false,
        rows: rows.length,
        validRows: valid.length,
        errorRows: rows.length - valid.length,
        recognisedColumns: capNames(found.recognised),
        missingOptionalColumns: capNames(
          found.missingOptional.map((f) => f.label),
        ),
        ignoredColumns: capNames(found.ignored),
      },
    ],
    rows,
    periodStart: period.start,
    periodEnd: period.end,
  };
}
