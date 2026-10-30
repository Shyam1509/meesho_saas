import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import {
  RECONCILIATION_RUN_STATUSES,
  RECONCILIATION_TRIGGER_TYPES,
  type ReconciliationRunStatus,
  type ReconciliationTriggerType,
} from './enums';
import { ImportJob } from './import-job.model';
import type { Attrs, CreationAttrs } from './model-types';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';

/** One settlement <-> order matching run. An 'import' run must name its import job (CHECK). */
@Table({
  tableName: 'reconciliation_runs',
  underscored: true,
  timestamps: true,
})
export class ReconciliationRun extends Model<
  Attrs<ReconciliationRun>,
  CreationAttrs<ReconciliationRun>
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

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [RECONCILIATION_TRIGGER_TYPES] },
  })
  triggerType!: ReconciliationTriggerType;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  importJobId!: CreationOptional<number | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  triggeredByUserId!: CreationOptional<number | null>;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [RECONCILIATION_RUN_STATUSES] },
  })
  status!: ReconciliationRunStatus;

  @Column({ type: DataType.DATE(3), allowNull: false })
  startedAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: true })
  finishedAt!: CreationOptional<Date | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  matchedCount!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  unmatchedSettlementCount!: CreationOptional<number | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true })
  unmatchedOrderCount!: CreationOptional<number | null>;

  @Column({ type: DataType.STRING(255), allowNull: true })
  failureMessage!: CreationOptional<string | null>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @BelongsTo(() => ImportJob, { foreignKey: 'importJobId' })
  importJob?: NonAttribute<ImportJob | null>;

  @BelongsTo(() => User, { foreignKey: 'triggeredByUserId' })
  triggeredBy?: NonAttribute<User | null>;
}
