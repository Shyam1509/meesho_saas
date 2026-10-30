import type { ValidationErrorDetailDto } from '../../common/errors/error-response.dto';
import type {
  ImportSheetSummary,
  SettlementEntryType,
} from '../../database/models';
import {
  COMPENSATION_OR_RECOVERY,
  SETTLEMENT_SHEET_PROFILES,
  type SheetProfile,
} from '../profiles/meesho-profiles';
import { FileRejectedError } from './file-rejected.error';
import { fingerprintTuple, FingerprintSequencer } from './fingerprint';
import {
  findHeaderRow,
  headerProblems,
  matchHeaders,
  profileForSheet,
  type HeaderMatch,
  type HeaderRowCandidate,
} from './header-matcher';
import type { RawCell } from './normalizers';
import {
  capNames,
  dateRange,
  tooManyRowsReason,
  type ParseLimits,
  type ParsedReport,
  type ParsedRow,
  type RowValues,
} from './parsed-report';
import { buildRow, isBlankRow } from './row-builder';
import type { SheetVisitor, WorkbookSheet } from './xlsx-reader';

/** The header row is searched among the first this-many non-empty rows of a sheet. */
export const HEADER_SEARCH_ROWS = 10;

const RECOGNISED_SHEET_NAMES = SETTLEMENT_SHEET_PROFILES.map(
  (p) => p.names[0],
).join(', ');

/**
 * "Compensation and Recovery" rows: a Type/Category value mentioning only "recovery" or only
 * "compensation" decides; otherwise the sign of the amount (negative → recovery, else compensation).
 */
export function compensationOrRecovery(
  typeLabel: string | null | undefined,
  amount: string,
): SettlementEntryType {
  const label = (typeLabel ?? '').toLowerCase();
  const recovery = label.includes('recover');
  const compensation = label.includes('compensat');
  if (recovery && !compensation) return 'recovery';
  if (compensation && !recovery) return 'compensation';
  return amount.startsWith('-') ? 'recovery' : 'compensation';
}

function emptySummary(
  name: string,
  entryType: string | null,
  ignored: boolean,
): ImportSheetSummary {
  return {
    name,
    entryType,
    ignored,
    rows: 0,
    validRows: 0,
    errorRows: 0,
    recognisedColumns: [],
    missingOptionalColumns: [],
    ignoredColumns: [],
  };
}

function isEmptyRow(cells: readonly RawCell[]): boolean {
  return cells.every(
    (c) => c === null || (typeof c === 'string' && c.trim() === ''),
  );
}

/**
 * One recognised sheet, fed row by row (streamed or from an array). The header is the first of the first
 * HEADER_SEARCH_ROWS non-empty rows that has every required column; after that each non-blank row is
 * normalised at once and only its mapped values are kept.
 */
export class SheetSession implements SheetVisitor {
  private readonly candidates: HeaderRowCandidate[] = [];
  private header: { rowNumber: number; match: HeaderMatch } | null = null;
  private failed = false;
  problem: ValidationErrorDetailDto | null = null;

  constructor(
    readonly profile: SheetProfile,
    readonly summary: ImportSheetSummary,
    private readonly owner: SettlementWorkbookParser,
  ) {}

  row(rowNumber: number, cells: RawCell[]): boolean {
    if (this.failed) return false;
    if (!this.header) return this.headerCandidate(rowNumber, cells);
    if (rowNumber <= this.header.rowNumber) return true;
    const { columns } = this.header.match;
    if (isBlankRow(cells, columns)) return true;
    this.owner.countDataRow();
    const built = buildRow(cells, columns);
    const values: RowValues = built.values;
    let rowHash: string | null = null;
    if (built.errors.length === 0) {
      const amount = values.settlementAmount as string;
      const entryType =
        this.profile.entryType === COMPENSATION_OR_RECOVERY
          ? compensationOrRecovery(values.typeLabel, amount)
          : this.profile.entryType;
      values.entryType = entryType;
      rowHash = this.owner.fingerprint(fingerprintTuple(this.profile, values));
    }
    this.summary.rows += 1;
    if (built.errors.length === 0) this.summary.validRows += 1;
    else this.summary.errorRows += 1;
    this.owner.addRow({
      sheetName: this.summary.name,
      rowNumber,
      errors: built.errors,
      values,
      rowHash,
    });
    return true;
  }

  private headerCandidate(rowNumber: number, cells: RawCell[]): boolean {
    if (isEmptyRow(cells)) return true;
    this.candidates.push({ rowNumber, cells });
    const match = matchHeaders(cells, this.profile.fields);
    if (match.missingRequired.length === 0) {
      this.candidates.length = 0;
      const problems = headerProblems(match);
      if (problems.length > 0) return this.fail(problems);
      this.header = { rowNumber, match };
      this.summary.recognisedColumns = capNames(match.recognised);
      this.summary.missingOptionalColumns = capNames(
        match.missingOptional.map((f) => f.label),
      );
      this.summary.ignoredColumns = capNames(match.ignored);
      return true;
    }
    if (this.candidates.length >= HEADER_SEARCH_ROWS) return this.failSearch();
    return true;
  }

  private failSearch(): false {
    const best = findHeaderRow(this.candidates, this.profile.fields);
    this.candidates.length = 0;
    return this.fail(best ? headerProblems(best.match) : []);
  }

  private fail(reasons: string[]): false {
    this.failed = true;
    this.problem = { field: `sheets.${this.summary.name}`, reasons };
    return false;
  }

  /** After the last row: a sheet with some rows but no complete header among them is a problem. */
  end(): void {
    if (!this.header && !this.failed && this.candidates.length > 0) {
      this.failSearch();
    }
  }
}

/**
 * Settlement workbook → rows, sheet by sheet in workbook order. Sheets are matched by normalised name;
 * "Disclaimer" and any other sheet are listed as ignored (and never read). Every sheet problem is collected
 * and reported together. Valid rows get fingerprint v2 (occurrence indexes across the whole file) in
 * `rowHash` and their entry type in `values.entryType`. A recognised sheet with no content contributes
 * nothing.
 */
export class SettlementWorkbookParser {
  private readonly sequencer = new FingerprintSequencer();
  private readonly summaries: ImportSheetSummary[] = [];
  private readonly sessions: SheetSession[] = [];
  private readonly rows: ParsedRow[] = [];
  private dataRows = 0;

  constructor(private readonly limits: ParseLimits) {}

  /**
   * Registers the next sheet; returns its session when the sheet is recognised, else null. Two sheets read
   * as the same kind (e.g. "Order Payments" and "Order Payments.") reject the file: the same rows would be
   * imported twice.
   */
  addSheet(name: string): SheetSession | null {
    const profile = profileForSheet(name, SETTLEMENT_SHEET_PROFILES);
    const summary = emptySummary(
      name,
      profile ? profile.entryType : null,
      !profile,
    );
    this.summaries.push(summary);
    if (!profile) return null;
    const twin = this.sessions.find((s) => s.profile === profile);
    if (twin) {
      throw FileRejectedError.of(
        'sheets',
        `Sheets "${twin.summary.name}" and "${name}" are both read as "${profile.names[0]}": keep only one`,
      );
    }
    const session = new SheetSession(profile, summary, this);
    this.sessions.push(session);
    return session;
  }

  /** No recognised sheet → rejected before any row is read. */
  assertRecognised(): void {
    if (this.sessions.length === 0) {
      throw FileRejectedError.of(
        'sheets',
        `No recognised sheet: expected one of ${RECOGNISED_SHEET_NAMES}`,
      );
    }
  }

  /** Counts one non-blank data row (all sheets together); more than maxRows rejects the file at once. */
  countDataRow(): void {
    this.dataRows += 1;
    if (this.dataRows > this.limits.maxRows) {
      throw FileRejectedError.of(
        'file',
        tooManyRowsReason(this.limits.maxRows),
      );
    }
  }

  fingerprint(tuple: (string | null)[]): string {
    return this.sequencer.next(tuple);
  }

  addRow(row: ParsedRow): void {
    this.rows.push(row);
  }

  finish(): ParsedReport {
    this.assertRecognised();
    for (const session of this.sessions) session.end();
    const problems = this.sessions
      .map((s) => s.problem)
      .filter((p): p is ValidationErrorDetailDto => p !== null);
    if (problems.length > 0) throw new FileRejectedError(problems);
    if (this.rows.length === 0) {
      throw FileRejectedError.of(
        'file',
        'The workbook has no data rows in its recognised sheets',
      );
    }
    const period = dateRange(
      this.rows
        .filter((r) => r.errors.length === 0)
        .map((r) => r.values.paymentDate),
    );
    return {
      reportType: 'settlement_xlsx',
      sheets: this.summaries,
      rows: this.rows,
      periodStart: period.start,
      periodEnd: period.end,
    };
  }
}

/** The same parse over sheets already in memory (tests, small inputs). */
export function parseSettlementWorkbook(
  sheets: WorkbookSheet[],
  limits: ParseLimits,
): ParsedReport {
  const parser = new SettlementWorkbookParser(limits);
  for (const sheet of sheets) {
    const session = parser.addSheet(sheet.name);
    if (!session) continue;
    for (const row of sheet.rows) {
      if (!session.row(row.rowNumber, row.cells)) break;
    }
  }
  return parser.finish();
}
