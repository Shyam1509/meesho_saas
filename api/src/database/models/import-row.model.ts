import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Model,
  Table,
} from 'sequelize-typescript';
import {
  IMPORT_ROW_ACTIONS,
  IMPORT_ROW_STATUSES,
  type ImportRowAction,
  type ImportRowStatus,
} from './enums';
import { ImportJob } from './import-job.model';
import type { Attrs, CreationAttrs } from './model-types';

/** One row-level validation problem, shown to the user with the row number. */
export interface ImportRowError {
  field: string;
  reason: string;
}

/** A source row of an import job (append-only staging + traceability). */
@Table({
  tableName: 'import_rows',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class ImportRow extends Model<
  Attrs<ImportRow, 'updatedAt'>,
  CreationAttrs<ImportRow, 'updatedAt'>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  importJobId!: number;

  /** Workbook sheet name; '' for CSV files. */
  @Column({ type: DataType.STRING(64), allowNull: false, defaultValue: '' })
  sheetName!: CreationOptional<string>;

  /** Row number as the user sees it in the file. */
  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: false })
  sourceRowNumber!: number;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [IMPORT_ROW_STATUSES] },
  })
  status!: ImportRowStatus;

  @Column({
    type: DataType.STRING(16),
    allowNull: true,
    validate: { isIn: [IMPORT_ROW_ACTIONS] },
  })
  action!: CreationOptional<ImportRowAction | null>;

  @Column({ type: DataType.JSON, allowNull: true })
  errors!: CreationOptional<ImportRowError[] | null>;

  /** Normalized source values, for traceability. */
  @Column({ type: DataType.JSON, allowNull: true })
  sourceValues!: CreationOptional<Record<string, unknown> | null>;

  @Column({ type: DataType.CHAR(64), allowNull: true })
  rowHash!: CreationOptional<string | null>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @BelongsTo(() => ImportJob, { foreignKey: 'importJobId' })
  importJob?: NonAttribute<ImportJob>;
}
