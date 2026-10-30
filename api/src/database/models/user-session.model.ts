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
import { User } from './user.model';

/**
 * Server-side sign-in session. Stores only the SHA-256 of the opaque cookie token (never the token).
 * No updated_at: last_used_at and revoked_at record the only changes. Deleted with its user (CASCADE).
 */
@Table({
  tableName: 'user_sessions',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class UserSession extends Model<
  Attrs<UserSession, 'updatedAt'>,
  CreationAttrs<UserSession, 'updatedAt'>
> {
  @Column({
    type: DataType.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: CreationOptional<number>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  userId!: number;

  /** SHA-256 hex of the session token. Must never be serialized into an API response. */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  tokenHash!: string;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @Column({ type: DataType.DATE(3), allowNull: false })
  lastUsedAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: false })
  absoluteExpiresAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: true })
  revokedAt!: CreationOptional<Date | null>;

  @BelongsTo(() => User, { foreignKey: 'userId' })
  user?: NonAttribute<User>;
}
