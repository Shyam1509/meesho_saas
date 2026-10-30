import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination.dto';
import { IMPORT_ACTIONS, type ImportAction } from '../import-actions';
import {
  IMPORT_JOB_STATUSES,
  IMPORT_REPORT_TYPES,
  IMPORT_ROW_ACTIONS,
  IMPORT_ROW_STATUSES,
  type ImportJobStatus,
  type ImportReportType,
  type ImportRowAction,
  type ImportRowStatus,
} from '../../database/models';

/** dataAsOf: a calendar date only (YYYY-MM-DD). */
export const DATA_AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Text fields of the multipart upload (the file itself is the `file` part). */
export class UploadImportDto {
  @ApiPropertyOptional({
    example: '2026-10-29',
    description:
      'REQUIRED for orders CSV, refused for workbooks: the day (YYYY-MM-DD) the report was downloaded from Meesho. Taken as the END of that day in India (23:59:59.999 IST); must not be after today (India time).',
  })
  @IsOptional()
  @IsString()
  @Matches(DATA_AS_OF_PATTERN, {
    message: 'dataAsOf must be a date in the form YYYY-MM-DD',
  })
  dataAsOf?: string;
}

export class ConfirmImportDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Required (true) when the import has rows with errors: they are skipped and recorded as skipped.',
  })
  @IsOptional()
  @IsBoolean()
  skipErrorRows?: boolean;
}

export class ListImportRowsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: IMPORT_ROW_STATUSES })
  @IsOptional()
  @IsIn(IMPORT_ROW_STATUSES)
  status?: ImportRowStatus;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class ImportCreatedByDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Asha' })
  displayName!: string | null;

  @ApiProperty({ example: 'seller@example.com' })
  email!: string;
}

export class ImportSummaryDto {
  @ApiProperty({ example: '12', description: 'BIGINT id as a string' })
  id!: string;

  @ApiProperty({ example: '3' })
  sellerAccountId!: string;

  @ApiProperty({ enum: IMPORT_REPORT_TYPES, example: 'orders_csv' })
  reportType!: ImportReportType;

  @ApiProperty({ enum: IMPORT_JOB_STATUSES, example: 'previewed' })
  status!: ImportJobStatus;

  @ApiProperty({ example: 'orders-oct.csv' })
  originalFilename!: string;

  @ApiProperty({ example: 20480 })
  fileSizeBytes!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Non-blank data rows (valid + error)',
  })
  totalRows!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  validRows!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  errorRows!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Set when completed: new orders / settlement entries',
  })
  insertedCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Set when completed: orders whose values changed',
  })
  updatedCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Set when completed: rows that changed nothing (orders with the same values, settlement entries already imported)',
  })
  unchangedCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Set when completed: orders rows older than what we have, recorded as status history only (0 for workbooks)',
  })
  historyOnlyCount!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-01' })
  reportPeriodStart!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-28' })
  reportPeriodEnd!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'When the statuses in the report were current: orders CSV = end of the given day in India; workbooks = the upload time',
  })
  dataAsOf!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: ImportCreatedByDto })
  createdBy!: ImportCreatedByDto;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  completedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Safe message when status is failed',
  })
  failureMessage!: string | null;

  @ApiProperty({
    enum: IMPORT_ACTIONS,
    isArray: true,
    example: ['confirm', 'cancel'],
    description:
      'What the caller may do now, decided by the server (previewed: confirm when it has valid rows and the account is active, cancel; failed or stale importing: retry, cancel)',
  })
  allowedActions!: ImportAction[];
}

export class ImportRowErrorDto {
  @ApiProperty({
    example: 'orderDate',
    description: 'Field key (as in values)',
  })
  field!: string;

  @ApiProperty({
    example:
      '"Order Date" is not a valid date (use DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD or DD Mon YYYY)',
  })
  reason!: string;
}

export class ImportRowDto {
  @ApiProperty({ example: '501' })
  id!: string;

  @ApiProperty({ example: '', description: "Workbook sheet; '' for CSV" })
  sheetName!: string;

  @ApiProperty({
    example: 2,
    description: 'Row number as seen in the file (header counted)',
  })
  rowNumber!: number;

  @ApiProperty({ enum: IMPORT_ROW_STATUSES })
  status!: ImportRowStatus;

  @ApiProperty({
    enum: IMPORT_ROW_ACTIONS,
    nullable: true,
    description:
      'Planned at upload, actual after confirm; null for rows with errors',
  })
  action!: ImportRowAction | null;

  @ApiProperty({ type: [ImportRowErrorDto] })
  errors!: ImportRowErrorDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    example: { subOrderNo: '1234567890_1', status: 'DELIVERED' },
    description:
      'Normalised values of the mapped columns only (raw text for a cell with an error)',
  })
  values!: Record<string, string | null>;
}

export class ImportSheetPreviewDto {
  @ApiProperty({ example: 'Order Payments', description: "'' for CSV" })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'order_payment',
    description:
      "Settlement entry type of the sheet, 'compensation_or_recovery' (decided per row), or null (CSV / ignored sheet)",
  })
  entryType!: string | null;

  @ApiProperty()
  ignored!: boolean;

  @ApiProperty()
  rows!: number;

  @ApiProperty()
  validRows!: number;

  @ApiProperty()
  errorRows!: number;

  @ApiProperty({ type: [String] })
  recognisedColumns!: string[];

  @ApiProperty({ type: [String] })
  missingOptionalColumns!: string[];

  @ApiProperty({
    type: [String],
    description: 'Columns that matched nothing (never stored)',
  })
  ignoredColumns!: string[];
}

export class ImportPlannedDto {
  @ApiProperty()
  insert!: number;

  @ApiProperty()
  update!: number;

  @ApiProperty()
  unchanged!: number;

  @ApiProperty({
    description:
      'Orders rows older than what we have: recorded as status history only',
  })
  historyOnly!: number;

  @ApiProperty({ description: 'Order status observations to record' })
  statusEvents!: number;
}

export class ImportPreviewDto {
  @ApiProperty({ type: [ImportSheetPreviewDto] })
  sheets!: ImportSheetPreviewDto[];

  @ApiProperty({
    type: ImportPlannedDto,
    description: 'Computed at upload time; confirm recomputes',
  })
  planned!: ImportPlannedDto;

  @ApiProperty({
    type: [ImportRowDto],
    description: 'First 10 rows without errors',
  })
  sampleRows!: ImportRowDto[];
}

export class ImportDetailDto extends ImportSummaryDto {
  @ApiProperty({ type: ImportPreviewDto })
  preview!: ImportPreviewDto;
}

export class ImportListDto {
  @ApiProperty({ type: [ImportSummaryDto], description: 'Newest first' })
  items!: ImportSummaryDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ImportRowListDto {
  @ApiProperty({
    type: [ImportRowDto],
    description: 'In file order (sheet, then row number)',
  })
  items!: ImportRowDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ImportConfigDto {
  @ApiProperty({ example: 10, description: 'Largest upload accepted, in MB' })
  maxFileMb!: number;

  @ApiProperty({
    example: 50000,
    description: 'Most non-blank data rows per file',
  })
  maxRows!: number;
}
