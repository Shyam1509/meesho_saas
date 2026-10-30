import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsTo,
  BelongsToMany,
  Column,
  CreatedAt,
  DataType,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { Expense } from './expense.model';
import type { Attrs, CreationAttrs } from './model-types';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';
import { WorkspaceMember } from './workspace-member.model';

/** Tenant boundary: owns seller accounts and expenses; users join through workspace_members. */
@Table({ tableName: 'workspaces', underscored: true, timestamps: true })
export class Workspace extends Model<
  Attrs<Workspace>,
  CreationAttrs<Workspace>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(120), allowNull: false })
  name!: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  createdByUserId!: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => User, { foreignKey: 'createdByUserId' })
  createdBy?: NonAttribute<User>;

  @BelongsToMany(() => User, {
    through: { model: () => WorkspaceMember },
    foreignKey: 'workspaceId',
    otherKey: 'userId',
  })
  members?: NonAttribute<User[]>;

  @HasMany(() => WorkspaceMember, { foreignKey: 'workspaceId' })
  memberships?: NonAttribute<WorkspaceMember[]>;

  @HasMany(() => SellerAccount, { foreignKey: 'workspaceId' })
  sellerAccounts?: NonAttribute<SellerAccount[]>;

  @HasMany(() => Expense, { foreignKey: 'workspaceId' })
  expenses?: NonAttribute<Expense[]>;
}
