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
  CURRENCIES,
  EXPENSE_SCOPES,
  type Currency,
  type ExpenseScope,
} from './enums';
import type { Attrs, CreationAttrs } from './model-types';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';
import { Workspace } from './workspace.model';

/**
 * Manual expense. scope 'workspace' => sellerAccountId NULL; scope 'account' => sellerAccountId set
 * (an account of the same workspace). Amount is positive.
 */
@Table({ tableName: 'expenses', underscored: true, timestamps: true })
export class Expense extends Model<Attrs<Expense>, CreationAttrs<Expense>> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  workspaceId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  sellerAccountId!: CreationOptional<number | null>;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [EXPENSE_SCOPES] },
  })
  scope!: ExpenseScope;

  /** 'YYYY-MM-DD'. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  expenseDate!: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  category!: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  description!: CreationOptional<string | null>;

  /** DECIMAL(12,2) as a string (exact), > 0. */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  amount!: string;

  @Column({
    type: DataType.CHAR(3),
    allowNull: false,
    defaultValue: 'INR',
    validate: { isIn: [CURRENCIES] },
  })
  currency!: CreationOptional<Currency>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  createdByUserId!: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => Workspace, { foreignKey: 'workspaceId' })
  workspace?: NonAttribute<Workspace>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount | null>;

  @BelongsTo(() => User, { foreignKey: 'createdByUserId' })
  createdBy?: NonAttribute<User>;
}
