import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Model,
  Table,
} from 'sequelize-typescript';
import type { Attrs, CreationAttrs } from './model-types';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';
import { Workspace } from './workspace.model';

/**
 * Append-only audit entry. actorUserId NULL = system. beforeData/afterData must never contain secrets
 * or full source rows.
 */
@Table({
  tableName: 'audit_logs',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class AuditLog extends Model<
  Attrs<AuditLog, 'updatedAt'>,
  CreationAttrs<AuditLog, 'updatedAt'>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  workspaceId!: CreationOptional<number | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  sellerAccountId!: CreationOptional<number | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  actorUserId!: CreationOptional<number | null>;

  /** e.g. 'product_cost.created'. */
  @Column({ type: DataType.STRING(64), allowNull: false })
  action!: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  entityType!: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  entityId!: string;

  @Column({ type: DataType.JSON, allowNull: true })
  beforeData!: CreationOptional<Record<string, unknown> | null>;

  @Column({ type: DataType.JSON, allowNull: true })
  afterData!: CreationOptional<Record<string, unknown> | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  requestId!: CreationOptional<string | null>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @BelongsTo(() => Workspace, { foreignKey: 'workspaceId' })
  workspace?: NonAttribute<Workspace | null>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount | null>;

  @BelongsTo(() => User, { foreignKey: 'actorUserId' })
  actor?: NonAttribute<User | null>;
}
