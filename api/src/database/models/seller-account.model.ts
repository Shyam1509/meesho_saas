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
import { SELLER_ACCOUNT_STATUSES, type SellerAccountStatus } from './enums';
import { Expense } from './expense.model';
import { ImportJob } from './import-job.model';
import type { Attrs, CreationAttrs } from './model-types';
import { Order } from './order.model';
import { Product } from './product.model';
import { ReconciliationRun } from './reconciliation-run.model';
import { SettlementEntry } from './settlement-entry.model';
import { Workspace } from './workspace.model';

/**
 * One Meesho seller account, owned by exactly one workspace. Holds no credentials of any kind:
 * meeshoSupplierId is an identifier shown in reports.
 */
@Table({ tableName: 'seller_accounts', underscored: true, timestamps: true })
export class SellerAccount extends Model<
  Attrs<SellerAccount>,
  CreationAttrs<SellerAccount>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  workspaceId!: number;

  @Column({ type: DataType.STRING(120), allowNull: false })
  displayName!: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  meeshoSupplierId!: CreationOptional<string | null>;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [SELLER_ACCOUNT_STATUSES] },
  })
  status!: CreationOptional<SellerAccountStatus>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => Workspace, { foreignKey: 'workspaceId' })
  workspace?: NonAttribute<Workspace>;

  @HasMany(() => ImportJob, { foreignKey: 'sellerAccountId' })
  importJobs?: NonAttribute<ImportJob[]>;

  @HasMany(() => Product, { foreignKey: 'sellerAccountId' })
  products?: NonAttribute<Product[]>;

  @HasMany(() => Order, { foreignKey: 'sellerAccountId' })
  orders?: NonAttribute<Order[]>;

  @HasMany(() => SettlementEntry, { foreignKey: 'sellerAccountId' })
  settlementEntries?: NonAttribute<SettlementEntry[]>;

  @HasMany(() => Expense, { foreignKey: 'sellerAccountId' })
  expenses?: NonAttribute<Expense[]>;

  @HasMany(() => ReconciliationRun, { foreignKey: 'sellerAccountId' })
  reconciliationRuns?: NonAttribute<ReconciliationRun[]>;
}
