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
import { ImportJob } from './import-job.model';
import { ImportRow } from './import-row.model';
import type { Attrs, CreationAttrs } from './model-types';
import { OrderStatusEvent } from './order-status-event.model';
import { Product } from './product.model';
import { SellerAccount } from './seller-account.model';
import { SettlementEntry } from './settlement-entry.model';

/**
 * Canonical order line (one Meesho sub-order), unique per (sellerAccountId, subOrderNo).
 * Status changes are recorded as OrderStatusEvent observations, never as duplicate orders.
 */
@Table({ tableName: 'orders', underscored: true, timestamps: true })
export class Order extends Model<Attrs<Order>, CreationAttrs<Order>> {
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

  @Column({ type: DataType.STRING(64), allowNull: false })
  subOrderNo!: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  orderNo!: CreationOptional<string | null>;

  /** 'YYYY-MM-DD'. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  orderDate!: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  productId!: CreationOptional<number | null>;

  @Column({ type: DataType.STRING(128), allowNull: true })
  sku!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  catalogId!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(512), allowNull: true })
  productName!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  size!: CreationOptional<string | null>;

  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: false })
  quantity!: number;

  @Column({ type: DataType.STRING(64), allowNull: true })
  customerState!: CreationOptional<string | null>;

  /** As reported (string, exact). Per-unit vs line total is decided in M4 from real samples. NULL = not reported. */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  supplierListedPrice!: CreationOptional<string | null>;

  /** As reported (string, exact). Per-unit vs line total is decided in M4 from real samples. NULL = not reported. */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  supplierDiscountedPrice!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  packetId!: CreationOptional<string | null>;

  /** Raw source status of the latest observation. */
  @Column({ type: DataType.STRING(64), allowNull: false })
  currentStatus!: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  currentStatusObservedAt!: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  firstImportJobId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  lastImportJobId!: number;

  /** Source row (of lastImportJobId) that the current values came from. */
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  lastImportRowId!: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @BelongsTo(() => Product, { foreignKey: 'productId' })
  product?: NonAttribute<Product | null>;

  @BelongsTo(() => ImportJob, { foreignKey: 'firstImportJobId' })
  firstImportJob?: NonAttribute<ImportJob>;

  @BelongsTo(() => ImportJob, { foreignKey: 'lastImportJobId' })
  lastImportJob?: NonAttribute<ImportJob>;

  @BelongsTo(() => ImportRow, { foreignKey: 'lastImportRowId' })
  lastImportRow?: NonAttribute<ImportRow>;

  @HasMany(() => OrderStatusEvent, { foreignKey: 'orderId' })
  statusEvents?: NonAttribute<OrderStatusEvent[]>;

  @HasMany(() => SettlementEntry, { foreignKey: 'orderId' })
  settlementEntries?: NonAttribute<SettlementEntry[]>;
}
