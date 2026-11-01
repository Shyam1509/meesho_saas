import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { ApiException } from '../common/errors/api.exception';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import {
  pageWindow,
  type PaginationQueryDto,
} from '../common/http/pagination.dto';
import { IST_OFFSET_MS, todayInIndia } from '../common/time/india-date';
import { AppConfigService } from '../config/app-config.service';
import {
  ImportJob,
  ImportRow,
  SellerAccount,
  User,
  type ImportPreviewSummary,
  type ImportRowStatus,
} from '../database/models';
import type {
  ImportConfigDto,
  ImportDetailDto,
  ImportListDto,
  ImportRowListDto,
  ListImportRowsQueryDto,
  UploadImportDto,
} from './dto/import.dto';
import { staleImportingCutoff } from './import-actions';
import {
  toImportDetailDto,
  toImportRowDto,
  toImportSummaryDto,
} from './import-mapper';
import { ImportParseLimiter } from './import-parse-limiter';
import { cleanFilename, detectReportType } from './parsing/file-type';
import { FileRejectedError } from './parsing/file-rejected.error';
import type { ParsedReport } from './parsing/parsed-report';
import { parseReport } from './parsing/report-parser';
import { chunk, countActions, planRows } from './planning/import-lookups';
import { PROFILE_VERSION } from './profiles/meesho-profiles';

export const PARSE_ERROR_MESSAGE = 'The file cannot be imported.';
export const ACCOUNT_DISABLED_MESSAGE =
  'This seller account is disabled: enable it before importing.';
export const FILE_REQUIRED_REASON =
  'A file is required (multipart field "file")';
export const DATA_AS_OF_REQUIRED_REASON =
  'dataAsOf is required for orders CSV files: the day (YYYY-MM-DD) you downloaded the report from Meesho';
const SAMPLE_ROWS = 10;
const CREATED_BY_ATTRIBUTES = ['id', 'displayName', 'email'];

/** An earlier import of the same file that blocks a new one (importing/completed). */
export async function findActiveDuplicate(
  sellerAccountId: number,
  reportType: string,
  fileSha256: string,
  excludeJobId?: number,
): Promise<ImportJob | null> {
  return ImportJob.findOne({
    where: {
      sellerAccountId,
      reportType,
      fileSha256,
      status: { [Op.in]: ['importing', 'completed'] },
      ...(excludeJobId ? { id: { [Op.ne]: excludeJobId } } : {}),
    },
    order: [['id', 'ASC']],
  });
}

export function duplicateFileException(earlierJobId: number): ApiException {
  return new ApiException(
    'CONFLICT',
    'This file has already been imported for this account.',
    [
      {
        field: 'file',
        reasons: [`Already imported as import ${earlierJobId}`],
      },
    ],
  );
}

// Moved to common/time in M6 (products and expenses use it too); re-exported for existing callers.
export { todayInIndia };

/**
 * "Statuses as of" date (YYYY-MM-DD, already pattern-checked) → the END of that day in India
 * (23:59:59.999 IST). A real calendar date, not after today in India, not before 2000.
 */
export function parseDataAsOf(value: string, now = Date.now()): Date {
  const invalid = (reason: string) =>
    new RequestValidationException([{ field: 'dataAsOf', reasons: [reason] }]);
  const [y, m, d] = value.split('-').map(Number);
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(calendar.getTime()) ||
    calendar.getUTCFullYear() !== y ||
    calendar.getUTCMonth() !== m - 1 ||
    calendar.getUTCDate() !== d
  ) {
    throw invalid('dataAsOf is not a valid date');
  }
  if (y < 2000) throw invalid('dataAsOf must not be before 2000-01-01');
  if (value > todayInIndia(now)) {
    throw invalid('dataAsOf must not be after today (India time)');
  }
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MS);
}

/**
 * Upload → preview (job 'previewed' + staged rows), and the read side of imports. Imports are
 * account-scoped: account routes go through requireAccount, /imports/:id routes through requireImportJob
 * (one query each); members and owners may do everything here. Confirm/retry live in ImportCommitService.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly parseLimiter: ImportParseLimiter,
  ) {}

  /** Upload limits for the client (GET /imports/config). */
  getConfig(): ImportConfigDto {
    return {
      maxFileMb: this.config.importMaxFileMb,
      maxRows: this.config.importMaxRows,
    };
  }

  async upload(
    actor: Actor,
    accountId: string,
    file: Express.Multer.File | undefined,
    body: UploadImportDto,
  ): Promise<ImportDetailDto> {
    if (!file) {
      throw new RequestValidationException([
        { field: 'file', reasons: [FILE_REQUIRED_REASON] },
      ]);
    }
    const { account } = await this.access.requireAccount(
      actor.userId,
      accountId,
      'member',
    );
    if (account.status !== 'active') {
      throw new ApiException('CONFLICT', ACCOUNT_DISABLED_MESSAGE);
    }

    let parsed: ParsedReport;
    let dataAsOf: Date;
    const started = Date.now();
    try {
      // Cheap checks first: type from extension + magic bytes decides whether dataAsOf belongs.
      const reportType = detectReportType(file.originalname, file.buffer);
      if (reportType === 'orders_csv' && !body.dataAsOf) {
        throw new RequestValidationException([
          { field: 'dataAsOf', reasons: [DATA_AS_OF_REQUIRED_REASON] },
        ]);
      }
      if (reportType !== 'orders_csv' && body.dataAsOf) {
        throw new RequestValidationException([
          {
            field: 'dataAsOf',
            reasons: ['dataAsOf applies to orders CSV files only'],
          },
        ]);
      }
      dataAsOf = body.dataAsOf ? parseDataAsOf(body.dataAsOf) : new Date();
      parsed = await this.parseLimiter.run(() =>
        parseReport(file.originalname, file.buffer, {
          maxRows: this.config.importMaxRows,
        }),
      );
    } catch (err) {
      if (err instanceof FileRejectedError) {
        throw new ApiException('PARSE_ERROR', PARSE_ERROR_MESSAGE, err.details);
      }
      throw err;
    }

    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await findActiveDuplicate(
      account.id,
      parsed.reportType,
      fileSha256,
    );
    if (duplicate) throw duplicateFileException(duplicate.id);

    const uploadedAt = new Date();
    const validRows = parsed.rows.filter((r) => r.errors.length === 0);
    const actions = await planRows(
      parsed.reportType,
      account.id,
      validRows,
      dataAsOf,
    );
    const actionOf = new Map(validRows.map((row, i) => [row, actions[i]]));
    const previewSummary: ImportPreviewSummary = {
      profileVersion: PROFILE_VERSION,
      sheets: parsed.sheets,
      planned: countActions(parsed.reportType, actions),
    };

    const jobId = await this.sequelize.transaction(async (transaction) => {
      const job = await ImportJob.create(
        {
          workspaceId: account.workspaceId,
          sellerAccountId: account.id,
          createdByUserId: actor.userId,
          reportType: parsed.reportType,
          status: 'previewed',
          originalFilename: cleanFilename(file.originalname, parsed.reportType),
          fileSizeBytes: file.size,
          fileSha256,
          reportPeriodStart: parsed.periodStart,
          reportPeriodEnd: parsed.periodEnd,
          dataAsOf,
          previewSummary,
          totalRows: parsed.rows.length,
          validRows: validRows.length,
          errorRows: parsed.rows.length - validRows.length,
          previewedAt: uploadedAt,
        },
        { transaction },
      );
      for (const batch of chunk(parsed.rows)) {
        await ImportRow.bulkCreate(
          batch.map((row) => ({
            importJobId: job.id,
            sheetName: row.sheetName,
            sourceRowNumber: row.rowNumber,
            status:
              row.errors.length === 0 ? ('valid' as const) : ('error' as const),
            action: actionOf.get(row) ?? null,
            errors: row.errors.length > 0 ? row.errors : null,
            sourceValues: row.values,
            rowHash: row.rowHash,
          })),
          { transaction },
        );
      }
      return job.id;
    });

    // Ids, counts and durations only: never file names or row values.
    this.logger.log(
      {
        event: 'import.previewed',
        importJobId: jobId,
        sellerAccountId: account.id,
        reportType: parsed.reportType,
        rows: parsed.rows.length,
        errorRows: parsed.rows.length - validRows.length,
        durationMs: Date.now() - started,
      },
      'Import previewed',
    );
    return this.detailById(jobId);
  }

  async list(
    userId: number,
    accountId: string,
    query: PaginationQueryDto,
  ): Promise<ImportListDto> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    const { limit, offset } = pageWindow(query);
    const { rows, count } = await ImportJob.findAndCountAll({
      where: { workspaceId: account.workspaceId, sellerAccountId: account.id },
      include: [
        { model: User, as: 'createdBy', attributes: CREATED_BY_ATTRIBUTES },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    });
    const accountActive = account.status === 'active';
    return {
      items: rows.map((job) =>
        toImportSummaryDto(job, job.createdBy as User, accountActive),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total: count,
    };
  }

  async get(userId: number, importId: string): Promise<ImportDetailDto> {
    const { importJob } = await this.access.requireImportJob(
      userId,
      importId,
      'member',
    );
    return this.detailById(importJob.id);
  }

  async rows(
    userId: number,
    importId: string,
    query: ListImportRowsQueryDto,
  ): Promise<ImportRowListDto> {
    const { importJob } = await this.access.requireImportJob(
      userId,
      importId,
      'member',
    );
    return this.pageOfRows(
      importJob.id,
      query,
      query.status ? [query.status] : null,
    );
  }

  /** Rows with errors: still 'error' before confirm, 'skipped' once confirmed with skipErrorRows. */
  async errors(
    userId: number,
    importId: string,
    query: PaginationQueryDto,
  ): Promise<ImportRowListDto> {
    const { importJob } = await this.access.requireImportJob(
      userId,
      importId,
      'member',
    );
    return this.pageOfRows(importJob.id, query, ['error', 'skipped']);
  }

  /**
   * previewed / failed / stale importing (confirmed more than 15 minutes ago) → cancelled, by a conditional
   * update, with audit import.cancelled. The job's staged import_rows are deleted (they hold report data
   * nobody will import); the job record and its counts stay.
   */
  async cancel(actor: Actor, importId: string): Promise<ImportDetailDto> {
    const { importJob } = await this.access.requireImportJob(
      actor.userId,
      importId,
      'member',
    );
    const deleted = await this.sequelize.transaction(async (transaction) => {
      const job = await ImportJob.findByPk(importJob.id, { transaction });
      if (!job) throw new Error(`import job ${importJob.id} vanished`);
      const [affected] = await ImportJob.update(
        { status: 'cancelled' },
        {
          where: {
            id: job.id,
            [Op.or]: [
              { status: { [Op.in]: ['previewed', 'failed'] } },
              {
                status: 'importing',
                confirmedAt: { [Op.lt]: staleImportingCutoff() },
              },
            ],
          },
          transaction,
        },
      );
      if (affected === 0) {
        throw new ApiException(
          'CONFLICT',
          `This import is ${job.status}: only a previewed, failed or stale importing import can be cancelled.`,
        );
      }
      const rowsDeleted = await ImportRow.destroy({
        where: { importJobId: job.id },
        transaction,
      });
      await this.audit.record(
        {
          action: 'import.cancelled',
          entityType: 'import_job',
          entityId: job.id,
          workspaceId: job.workspaceId,
          sellerAccountId: job.sellerAccountId,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          before: { status: job.status },
          after: { status: 'cancelled', stagedRowsDeleted: rowsDeleted },
        },
        transaction,
      );
      return rowsDeleted;
    });
    this.logger.log(
      {
        event: 'import.cancelled',
        importJobId: importJob.id,
        stagedRowsDeleted: deleted,
      },
      'Import cancelled',
    );
    return this.detailById(importJob.id);
  }

  /** ImportDetail of a job the caller has already been authorised for. */
  async detailById(jobId: number): Promise<ImportDetailDto> {
    const job = await ImportJob.findByPk(jobId, {
      include: [
        { model: User, as: 'createdBy', attributes: CREATED_BY_ATTRIBUTES },
        { model: SellerAccount, as: 'sellerAccount', attributes: ['status'] },
      ],
    });
    if (!job) throw new Error(`import job ${jobId} vanished`);
    const sample = await ImportRow.findAll({
      where: {
        importJobId: job.id,
        status: { [Op.in]: ['valid', 'imported'] },
      },
      order: [['id', 'ASC']],
      limit: SAMPLE_ROWS,
    });
    return toImportDetailDto(
      job,
      job.createdBy as User,
      job.sellerAccount?.status === 'active',
      sample,
    );
  }

  private async pageOfRows(
    importJobId: number,
    query: PaginationQueryDto,
    statuses: ImportRowStatus[] | null,
  ): Promise<ImportRowListDto> {
    const { limit, offset } = pageWindow(query);
    const where: WhereOptions<ImportRow> = statuses
      ? { importJobId, status: { [Op.in]: statuses } }
      : { importJobId };
    const { rows, count } = await ImportRow.findAndCountAll({
      where,
      // Rows were inserted in file order (sheet by sheet, then row number).
      order: [['id', 'ASC']],
      limit,
      offset,
    });
    return {
      items: rows.map(toImportRowDto),
      page: query.page,
      pageSize: query.pageSize,
      total: count,
    };
  }
}
