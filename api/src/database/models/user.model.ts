import type { CreationOptional, NonAttribute } from 'sequelize';
import {
  BelongsToMany,
  Column,
  CreatedAt,
  DataType,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { USER_STATUSES, type UserStatus } from './enums';
import type { Attrs, CreationAttrs } from './model-types';
import { WorkspaceMember } from './workspace-member.model';
import { Workspace } from './workspace.model';

/** Sign-in identity. Users are disabled (status), never hard-deleted. */
@Table({ tableName: 'users', underscored: true, timestamps: true })
export class User extends Model<Attrs<User>, CreationAttrs<User>> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(254), allowNull: false })
  email!: string;

  /** Password hash only. Must never be serialized into an API response. */
  @Column({ type: DataType.STRING(255), allowNull: false })
  passwordHash!: string;

  @Column({ type: DataType.STRING(120), allowNull: true })
  displayName!: CreationOptional<string | null>;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [USER_STATUSES] },
  })
  status!: CreationOptional<UserStatus>;

  @Column({ type: DataType.DATE(3), allowNull: true })
  lastLoginAt!: CreationOptional<Date | null>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsToMany(() => Workspace, {
    through: { model: () => WorkspaceMember },
    foreignKey: 'userId',
    otherKey: 'workspaceId',
  })
  workspaces?: NonAttribute<Workspace[]>;

  @HasMany(() => WorkspaceMember, { foreignKey: 'userId' })
  memberships?: NonAttribute<WorkspaceMember[]>;
}
