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
  SETTLEMENT_ENTRY_TYPES,
  SETTLEMENT_MATCH_METHODS,
  type SettlementEntryType,
  type SettlementMatchMethod,
} from './enums';
import { ImportJob } from './import-job.model';
import { ImportRow } from './import-row.model';
import type { Attrs, CreationAttrs } from './model-types';
import { Order } from './order.model';
import { SellerAccount } from './seller-account.model';
import { User } from './user.model';

/**
 * One settlement workbook row. transactionId is NOT unique; idempotency is
 * UNIQUE (sellerAccountId, entryFingerprint). Money: DECIMAL strings, NULL = not reported (never 0).
 * Totals include only entries whose supersededByEntryId is NULL.
 */
@Table({ tableName: 'settlement_entries', underscored: true, timestamps: true })
export class SettlementEntry extends Model<
  Attrs<SettlementEntry>,
  CreationAttrs<SettlementEntry>
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
  importJobId!: number;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false })
  importRowId!: number;

  @Column({ type: DataType.STRING(64), allowNull: false })
  sheetName!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    validate: { isIn: [SETTLEMENT_ENTRY_TYPES] },
  })
  entryType!: SettlementEntryType;

  @Column({ type: DataType.STRING(64), allowNull: true })
  transactionId!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(64), allowNull: true })
  subOrderNo!: CreationOptional<string | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  orderId!: CreationOptional<number | null>;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  orderDate!: CreationOptional<string | null>;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  paymentDate!: CreationOptional<string | null>;

  /** The row's settlement effect as reported. */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  settlementAmount!: string;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  saleAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  returnAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  commissionAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  shippingCharge!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  tcsAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  tdsAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  recoveryAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  compensationAmount!: CreationOptional<string | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isEstimate!: CreationOptional<boolean>;

  /**
   * sha256 over the FIXED field list of fingerprintVersion (normalized) + the occurrence index among
   * identical rows in the same file. Never computed over "all columns".
   */
  @Column({ type: DataType.CHAR(64), allowNull: false })
  entryFingerprint!: string;

  /** Version of the fingerprint field list; set explicitly by the importer (no default). */
  @Column({ type: DataType.SMALLINT.UNSIGNED, allowNull: false })
  fingerprintVersion!: number;

  /** Later entry (same account) that replaces this one. Must never be the entry itself (M5 enforces). */
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  supersededByEntryId!: CreationOptional<number | null>;

  /**
   * Set together with orderId (ck_settlement_entries_match_consistency). 'auto' requires matchedAt;
   * 'manual' requires matchedAt and matchedByUserId.
   */
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
    validate: { isIn: [SETTLEMENT_MATCH_METHODS] },
  })
  matchMethod!: CreationOptional<SettlementMatchMethod | null>;

  @Column({ type: DataType.DATE(3), allowNull: true })
  matchedAt!: CreationOptional<Date | null>;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true })
  matchedByUserId!: CreationOptional<number | null>;

  /**
   * Set by a manual unmatch (M5): the automatic matcher skips the entry so it does not redo a match the
   * owner removed. A manual match clears it.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  autoMatchBlocked!: CreationOptional<boolean>;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  createdAt!: CreationOptional<Date>;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  updatedAt!: CreationOptional<Date>;

  @BelongsTo(() => SellerAccount, { foreignKey: 'sellerAccountId' })
  sellerAccount?: NonAttribute<SellerAccount>;

  @BelongsTo(() => ImportJob, { foreignKey: 'importJobId' })
  importJob?: NonAttribute<ImportJob>;

  @BelongsTo(() => ImportRow, { foreignKey: 'importRowId' })
  importRow?: NonAttribute<ImportRow>;

  @BelongsTo(() => Order, { foreignKey: 'orderId' })
  order?: NonAttribute<Order | null>;

  @BelongsTo(() => SettlementEntry, { foreignKey: 'supersededByEntryId' })
  supersededBy?: NonAttribute<SettlementEntry | null>;

  @BelongsTo(() => User, { foreignKey: 'matchedByUserId' })
  matchedBy?: NonAttribute<User | null>;
}
