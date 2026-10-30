import { AuditLog } from './audit-log.model';
import { Expense } from './expense.model';
import { ImportJob } from './import-job.model';
import { ImportRow } from './import-row.model';
import { OrderStatusEvent } from './order-status-event.model';
import { Order } from './order.model';
import { ProductCostHistory } from './product-cost-history.model';
import { Product } from './product.model';
import { ReconciliationRun } from './reconciliation-run.model';
import { SellerAccount } from './seller-account.model';
import { SettlementEntry } from './settlement-entry.model';
import { User } from './user.model';
import { WorkspaceMember } from './workspace-member.model';
import { Workspace } from './workspace.model';

/**
 * Sequelize models, one per table created by db/migrations. Registered with the connection in
 * DatabaseModule (synchronize: false): the schema is owned by migrations, models never sync it.
 *
 * Models are persistence objects. Never return a model instance raw from a controller: map it to a
 * response DTO, so internal columns (password_hash, storage keys, audit payloads, ...) cannot leak and the
 * API shape does not change when the schema does.
 */
export const MODELS = [
  User,
  Workspace,
  WorkspaceMember,
  SellerAccount,
  ImportJob,
  ImportRow,
  Product,
  ProductCostHistory,
  Order,
  OrderStatusEvent,
  SettlementEntry,
  Expense,
  ReconciliationRun,
  AuditLog,
] as const;

export {
  AuditLog,
  Expense,
  ImportJob,
  ImportRow,
  Order,
  OrderStatusEvent,
  Product,
  ProductCostHistory,
  ReconciliationRun,
  SellerAccount,
  SettlementEntry,
  User,
  Workspace,
  WorkspaceMember,
};
export * from './enums';
export type { ImportRowError } from './import-row.model';
