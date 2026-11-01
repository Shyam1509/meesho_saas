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
import { CURRENCIES, type Currency } from './enums';
import type { Attrs, CreationAttrs } from './model-types';
import { Product } from './product.model';
import { User } from './user.model';

/**
 * Effective-dated unit cost. Effective cost on date D = the row with the greatest effectiveFrom <= D;
 * no such row means the cost is unknown (never zero).
 */
@Table({
  tableName: 'product_cost_history',
  underscored: true,
  timestamps: true,
})
export class ProductCostHistory extends Model<
  Attrs<ProductCostHistory>,
  CreationAttrs<ProductCostHistory>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  productId!: number;

  /**
   * DECIMAL(12,4) as a string (exact; lot-based costs such as 1000/3). Line cost = unitCost x quantity,
   * computed by MySQL in DECIMAL and returned exactly with 4 decimals (M6; the UI shows 2).
   */
  @Column({ type: DataType.DECIMAL(12, 4), allowNull: false })
  unitCost!: string;

  @Column({
    type: DataType.CHAR(3),
    allowNull: false,
    defaultValue: 'INR',
    validate: { isIn: [CURRENCIES] },
  })
  currency!: CreationOptional<Currency>;

  /** 'YYYY-MM-DD'. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  effectiveFrom!: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  note!: CreationOptional<string | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  createdByUserId!: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => Product, { foreignKey: 'productId' })
  product?: NonAttribute<Product>;

  @BelongsTo(() => User, { foreignKey: 'createdByUserId' })
  createdBy?: NonAttribute<User>;
}
