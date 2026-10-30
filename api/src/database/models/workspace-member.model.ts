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
import { WORKSPACE_ROLES, type WorkspaceRole } from './enums';
import type { Attrs, CreationAttrs } from './model-types';
import { User } from './user.model';
import { Workspace } from './workspace.model';

/** Membership of a user in a workspace (deleted with the workspace or the user: ON DELETE CASCADE). */
@Table({ tableName: 'workspace_members', underscored: true, timestamps: true })
export class WorkspaceMember extends Model<
  Attrs<WorkspaceMember>,
  CreationAttrs<WorkspaceMember>
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
  userId!: number;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    validate: { isIn: [WORKSPACE_ROLES] },
  })
  role!: WorkspaceRole;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => Workspace, { foreignKey: 'workspaceId' })
  workspace?: NonAttribute<Workspace>;

  @BelongsTo(() => User, { foreignKey: 'userId' })
  user?: NonAttribute<User>;
}
