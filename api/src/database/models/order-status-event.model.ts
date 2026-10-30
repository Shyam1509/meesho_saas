import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Model,
  Table,
} from 'sequelize-typescript';
import { ImportJob } from './import-job.model';
import { ImportRow } from './import-row.model';
import type { Attrs, CreationAttrs } from './model-types';
import { Order } from './order.model';
import { SellerAccount } from './seller-account.model';

/**
 * Append-only status observation; one per order per import job. Account-scoped: order, import job and
 * source row all belong to the same account (composite FKs). observedAt comes from the report
 * period/generation date when known, else the import time (M4).
 */
@Table({
  tableName: 'order_status_events',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class OrderStatusEvent extends Model<
  Attrs<OrderStatusEvent, 'updatedAt'>,
  CreationAttrs<OrderStatusEvent, 'updatedAt'>
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
  orderId!: number;

  /** Raw source status as observed. */
  @Column({ type: DataType.STRING(64), allowNull: false })
  status!: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  observedAt!: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  importJobId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  importRowId!: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @BelongsTo(() => Order, { foreignKey: 'orderId' })
  order?: NonAttribute<Order>;

  @BelongsTo(() => ImportJob, { foreignKey: 'importJobId' })
  importJob?: NonAttribute<ImportJob>;

  @BelongsTo(() => ImportRow, { foreignKey: 'importRowId' })
  importRow?: NonAttribute<ImportRow>;
}
