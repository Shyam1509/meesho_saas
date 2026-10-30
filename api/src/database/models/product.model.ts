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
import { PRODUCT_STATUSES, type ProductStatus } from './enums';
import type { Attrs, CreationAttrs } from './model-types';
import { Order } from './order.model';
import { ProductCostHistory } from './product-cost-history.model';
import { SellerAccount } from './seller-account.model';

/** A product (SKU) of one seller account. SKU comparison is exact (utf8mb4_bin). */
@Table({ tableName: 'products', underscored: true, timestamps: true })
export class Product extends Model<Attrs<Product>, CreationAttrs<Product>> {
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

  @Column({ type: DataType.STRING(128), allowNull: false })
  sku!: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  catalogId!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(512), allowNull: true })
  name!: CreationOptional<string | null>;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [PRODUCT_STATUSES] },
  })
  status!: CreationOptional<ProductStatus>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @HasMany(() => ProductCostHistory, { foreignKey: 'productId' })
  costHistory?: NonAttribute<ProductCostHistory[]>;

  @HasMany(() => Order, { foreignKey: 'productId' })
  orders?: NonAttribute<Order[]>;
}
