import type { ImportJob, ImportRow, User } from '../database/models';
import type {
  ImportDetailDto,
  ImportRowDto,
  ImportSummaryDto,
} from './dto/import.dto';
import { allowedActions } from './import-actions';

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

/** JSON columns come back parsed from mysql2; tolerate a string just in case. */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

export function toImportSummaryDto(
  job: ImportJob,
  createdBy: Pick<User, 'id' | 'displayName' | 'email'>,
  accountActive: boolean,
  now = Date.now(),
): ImportSummaryDto {
  return {
    id: String(job.id),
    sellerAccountId: String(job.sellerAccountId),
    reportType: job.reportType,
    status: job.status,
    originalFilename: job.originalFilename,
    fileSizeBytes: Number(job.fileSizeBytes),
    totalRows: job.totalRows,
    validRows: job.validRows,
    errorRows: job.errorRows,
    insertedCount: job.insertedCount,
    updatedCount: job.updatedCount,
    unchangedCount: job.unchangedCount,
    historyOnlyCount: job.historyOnlyCount,
    reportPeriodStart: job.reportPeriodStart,
    reportPeriodEnd: job.reportPeriodEnd,
    dataAsOf: iso(job.dataAsOf),
    createdAt: job.createdAt.toISOString(),
    createdBy: {
      id: String(createdBy.id),
      displayName: createdBy.displayName,
      email: createdBy.email,
    },
    confirmedAt: iso(job.confirmedAt),
    completedAt: iso(job.completedAt),
    failureMessage: job.failureMessage,
    allowedActions: allowedActions(
      {
        status: job.status,
        validRows: job.validRows,
        confirmedAt: job.confirmedAt,
        accountActive,
      },
      now,
    ),
  };
}

export function toImportRowDto(row: ImportRow): ImportRowDto {
  const values = parseJson<Record<string, unknown>>(row.sourceValues) ?? {};
  const stringValues: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(values)) {
    stringValues[key] =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : null;
  }
  return {
    id: String(row.id),
    sheetName: row.sheetName,
    rowNumber: row.sourceRowNumber,
    status: row.status,
    action: row.action,
    errors: parseJson<ImportRowDto['errors']>(row.errors) ?? [],
    values: stringValues,
  };
}

export function toImportDetailDto(
  job: ImportJob,
  createdBy: Pick<User, 'id' | 'displayName' | 'email'>,
  accountActive: boolean,
  sampleRows: ImportRow[],
): ImportDetailDto {
  const summary = parseJson<NonNullable<ImportJob['previewSummary']>>(
    job.previewSummary,
  );
  return {
    ...toImportSummaryDto(job, createdBy, accountActive),
    preview: {
      sheets: summary?.sheets ?? [],
      planned: {
        insert: 0,
        update: 0,
        unchanged: 0,
        historyOnly: 0,
        statusEvents: 0,
        ...summary?.planned,
      },
      sampleRows: sampleRows.map(toImportRowDto),
    },
  };
}
