import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import {
  IMPORT_JOB_STATUSES,
  IMPORT_REPORT_TYPES,
  type ImportJobStatus,
  type ImportReportType,
} from './enums';
import { ImportRow } from './import-row.model';
import type { Attrs, CreationAttrs } from './model-types';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';

/** One sheet (or the CSV file, name '') as the parser saw it. Column NAMES only, never values. */
export interface ImportSheetSummary {
  name: string;
  /** Settlement entry type of the sheet, 'compensation_or_recovery' (decided per row), or null (CSV / ignored). */
  entryType: string | null;
  ignored: boolean;
  rows: number;
  validRows: number;
  errorRows: number;
  recognisedColumns: string[];
  missingOptionalColumns: string[];
  ignoredColumns: string[];
}

/** import_jobs.preview_summary (JSON). */
export interface ImportPreviewSummary {
  /** Version of the header profile file that parsed the upload. */
  profileVersion: number;
  sheets: ImportSheetSummary[];
  /** Planned at upload time against the data then in the database; confirm recomputes. */
  planned: {
    insert: number;
    update: number;
    unchanged: number;
    /** Orders rows older than what is stored: status history only. */
    historyOnly: number;
    statusEvents: number;
  };
}

/**
 * One uploaded report file for one seller account. Only one 'importing'/'completed' job per
 * (sellerAccountId, reportType, fileSha256): enforced by the generated activeFileSha256 column's unique key;
 * pending/previewed/failed/cancelled jobs for the same file are allowed (retry).
 */
@Table({ tableName: 'import_jobs', underscored: true, timestamps: true })
export class ImportJob extends Model<
  Attrs<ImportJob>,
  CreationAttrs<ImportJob>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  workspaceId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  sellerAccountId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  createdByUserId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  confirmedByUserId!: CreationOptional<number | null>;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    validate: { isIn: [IMPORT_REPORT_TYPES] },
  })
  reportType!: ImportReportType;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [IMPORT_JOB_STATUSES] },
  })
  status!: ImportJobStatus;

  @Column({ type: DataType.STRING(255), allowNull: false })
  originalFilename!: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  fileSizeBytes!: number;

  /** Lowercase hex sha256 of the uploaded bytes. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  fileSha256!: string;

  /**
   * STORED generated column (fileSha256 while importing/completed, else NULL). Read-only: kept out of the
   * attribute types so it is never written; Sequelize does not refresh it after create/update (reload).
   */
  @Column({ type: DataType.CHAR(64), allowNull: true })
  activeFileSha256?: NonAttribute<string | null>;

  /** 'YYYY-MM-DD'. Period covered by the report, when known (end >= start). */
  @Column({ type: DataType.DATEONLY, allowNull: true })
  reportPeriodStart!: CreationOptional<string | null>;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  reportPeriodEnd!: CreationOptional<string | null>;

  /**
   * When the report's statuses were current: the user-supplied "statuses as of" time (orders CSV), else
   * the upload time. order_status_events.observed_at is this value (M4).
   */
  @Column({ type: DataType.DATE(3), allowNull: true })
  dataAsOf!: CreationOptional<Date | null>;

  /** What the parser saw (sheets, column names, planned counts). Never row values. */
  @Column({ type: DataType.JSON, allowNull: true })
  previewSummary!: CreationOptional<ImportPreviewSummary | null>;

  @Column({ type: DataType.STRING(512), allowNull: true })
  storageKey!: CreationOptional<string | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  totalRows!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  validRows!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  errorRows!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  insertedCount!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  updatedCount!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  unchangedCount!: CreationOptional<number | null>;

  /** Orders rows older than the order's current observation: recorded as status history only. */
  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  historyOnlyCount!: CreationOptional<number | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  failureCode!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(255), allowNull: true })
  failureMessage!: CreationOptional<string | null>;

  @Column({ type: DataType.DATE(3), allowNull: true })
  previewedAt!: CreationOptional<Date | null>;

  @Column({ type: DataType.DATE(3), allowNull: true })
  confirmedAt!: CreationOptional<Date | null>;

  @Column({ type: DataType.DATE(3), allowNull: true })
  completedAt!: CreationOptional<Date | null>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @BelongsTo(() => User, { foreignKey: 'createdByUserId' })
  createdBy?: NonAttribute<User>;

  @BelongsTo(() => User, { foreignKey: 'confirmedByUserId' })
  confirmedBy?: NonAttribute<User | null>;

  @HasMany(() => ImportRow, { foreignKey: 'importJobId' })
  rows?: NonAttribute<ImportRow[]>;
}
