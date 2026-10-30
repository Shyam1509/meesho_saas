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
