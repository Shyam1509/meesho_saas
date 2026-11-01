import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type {
  ExpenseScope,
  SellerAccountStatus,
  WorkspaceRole,
} from '../database/models';
import { hasRole } from './roles';

export const WORKSPACE_NOT_FOUND_MESSAGE = 'Workspace not found.';
export const ACCOUNT_NOT_FOUND_MESSAGE = 'Seller account not found.';
export const IMPORT_NOT_FOUND_MESSAGE = 'Import not found.';
export const PRODUCT_NOT_FOUND_MESSAGE = 'Product not found.';
export const EXPENSE_NOT_FOUND_MESSAGE = 'Expense not found.';
export const INSUFFICIENT_ROLE_MESSAGE =
  'You do not have permission to perform this action.';

export interface AccessOptions {
  transaction?: Transaction;
  /** SELECT ... FOR UPDATE (requires `transaction`): locks the row and the membership until commit. */
  lock?: boolean;
}

/** A workspace row the caller is a member of, with the caller's role. */
export interface WorkspaceAccess {
  workspace: {
    id: number;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  };
  role: WorkspaceRole;
}

/** A seller account row in a workspace the caller is a member of, with the caller's role there. */
export interface AccountAccess {
  account: {
    id: number;
    workspaceId: number;
    displayName: string;
    meeshoSupplierId: string | null;
    status: SellerAccountStatus;
    createdAt: Date;
    updatedAt: Date;
  };
  role: WorkspaceRole;
}

/**
 * The single place that turns a client-supplied workspace/account id into an authorised row. Each check
 * is ONE query joining the row with the caller's membership:
 * - row missing or caller not a member → 404 (existence is never revealed);
 * - member without `minRole` → 403.
 * Callers must use the ids returned here (never the client's) for every later query.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async requireWorkspace(
    userId: number,
    workspaceId: string,
    minRole: WorkspaceRole,
    options: AccessOptions = {},
  ): Promise<WorkspaceAccess> {
    const [row] = await this.sequelize.query<
      WorkspaceAccess['workspace'] & { role: WorkspaceRole }
    >(
      `SELECT w.id, w.name, w.created_at AS createdAt, w.updated_at AS updatedAt, m.role
       FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = :userId
       WHERE w.id = CAST(:workspaceId AS UNSIGNED)${lockClause(options)}`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, workspaceId },
        transaction: options.transaction,
      },
    );
    if (!row) throw new NotFoundException(WORKSPACE_NOT_FOUND_MESSAGE);
    assertRole(row.role, minRole);
    const { role, ...workspace } = row;
    return { workspace, role };
  }

  async requireAccount(
    userId: number,
    accountId: string,
    minRole: WorkspaceRole,
    options: AccessOptions = {},
  ): Promise<AccountAccess> {
    const [row] = await this.sequelize.query<
      AccountAccess['account'] & { role: WorkspaceRole }
    >(
      `SELECT a.id, a.workspace_id AS workspaceId, a.display_name AS displayName,
              a.meesho_supplier_id AS meeshoSupplierId, a.status,
              a.created_at AS createdAt, a.updated_at AS updatedAt, m.role
       FROM seller_accounts a
       JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.user_id = :userId
       WHERE a.id = CAST(:accountId AS UNSIGNED)${lockClause(options)}`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, accountId },
        transaction: options.transaction,
      },
    );
    if (!row) throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    assertRole(row.role, minRole);
    const { role, ...account } = row;
    return { account, role };
  }

  /** The import job (via its account's workspace) if the caller is a member with `minRole`. */
  async requireImportJob(
    userId: number,
    importId: string,
    minRole: WorkspaceRole,
    options: AccessOptions = {},
  ): Promise<ImportJobAccess> {
    const [row] = await this.sequelize.query<
      ImportJobAccess['importJob'] & {
        accountStatus: SellerAccountStatus;
        role: WorkspaceRole;
      }
    >(
      `SELECT j.id, j.workspace_id AS workspaceId, j.seller_account_id AS sellerAccountId,
              a.status AS accountStatus, m.role
       FROM import_jobs j
       JOIN seller_accounts a ON a.id = j.seller_account_id AND a.workspace_id = j.workspace_id
       JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.user_id = :userId
       WHERE j.id = CAST(:importId AS UNSIGNED)${lockClause(options)}`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, importId },
        transaction: options.transaction,
      },
    );
    if (!row) throw new NotFoundException(IMPORT_NOT_FOUND_MESSAGE);
    assertRole(row.role, minRole);
    const { role, accountStatus, ...importJob } = row;
    return { importJob, accountStatus, role };
  }

  /**
   * The product (via its account's workspace) if the caller is a member with `minRole`: one query, like
   * requireImportJob. No lock option: product writes lock the ACCOUNT row first (inAccountTransaction),
   * always in that order, then re-read the product inside that transaction.
   */
  async requireProduct(
    userId: number,
    productId: string,
    minRole: WorkspaceRole,
    options: Pick<AccessOptions, 'transaction'> = {},
  ): Promise<ProductAccess> {
    const [row] = await this.sequelize.query<
      ProductAccess['product'] & {
        accountStatus: SellerAccountStatus;
        role: WorkspaceRole;
      }
    >(
      `SELECT p.id, p.workspace_id AS workspaceId, p.seller_account_id AS sellerAccountId,
              a.status AS accountStatus, m.role
       FROM products p
       JOIN seller_accounts a ON a.id = p.seller_account_id AND a.workspace_id = p.workspace_id
       JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.user_id = :userId
       WHERE p.id = CAST(:productId AS UNSIGNED)`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, productId },
        transaction: options.transaction,
      },
    );
    if (!row) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    assertRole(row.role, minRole);
    const { role, accountStatus, ...product } = row;
    return { product, accountStatus, role };
  }

  /**
   * The expense (workspace- or account-scoped) if the caller is a member of its workspace with `minRole`:
   * one query. `accountStatus` is the status of its seller account (null for a workspace expense). No lock
   * option: the caller locks the expense row itself inside its transaction.
   */
  async requireExpense(
    userId: number,
    expenseId: string,
    minRole: WorkspaceRole,
    options: Pick<AccessOptions, 'transaction'> = {},
  ): Promise<ExpenseAccess> {
    const [row] = await this.sequelize.query<
      ExpenseAccess['expense'] & {
        accountStatus: SellerAccountStatus | null;
        role: WorkspaceRole;
      }
    >(
      `SELECT e.id, e.workspace_id AS workspaceId, e.seller_account_id AS sellerAccountId, e.scope,
              a.status AS accountStatus, m.role
       FROM expenses e
       JOIN workspace_members m ON m.workspace_id = e.workspace_id AND m.user_id = :userId
       LEFT JOIN seller_accounts a ON a.id = e.seller_account_id AND a.workspace_id = e.workspace_id
       WHERE e.id = CAST(:expenseId AS UNSIGNED)`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, expenseId },
        transaction: options.transaction,
      },
    );
    if (!row) throw new NotFoundException(EXPENSE_NOT_FOUND_MESSAGE);
    assertRole(row.role, minRole);
    const { role, accountStatus, ...expense } = row;
    return { expense, accountStatus, role };
  }
}

/** A product the caller may see, resolved through its seller account to the caller's membership. */
export interface ProductAccess {
  product: {
    id: number;
    workspaceId: number;
    sellerAccountId: number;
  };
  accountStatus: SellerAccountStatus;
  role: WorkspaceRole;
}

/** An expense the caller may see, resolved through its workspace to the caller's membership. */
export interface ExpenseAccess {
  expense: {
    id: number;
    workspaceId: number;
    sellerAccountId: number | null;
    scope: ExpenseScope;
  };
  /** Status of the expense's seller account; null for a workspace-scoped expense. */
  accountStatus: SellerAccountStatus | null;
  role: WorkspaceRole;
}

/**
 * An import job the caller may see: resolved through its seller account to the caller's membership in
 * one query (requireImportJob). Same rules as accounts: missing or not a member → 404, too low a role → 403.
 */
export interface ImportJobAccess {
  importJob: {
    id: number;
    workspaceId: number;
    sellerAccountId: number;
  };
  accountStatus: SellerAccountStatus;
  role: WorkspaceRole;
}

function assertRole(role: WorkspaceRole, minRole: WorkspaceRole): void {
  if (!hasRole(role, minRole)) {
    throw new ForbiddenException(INSUFFICIENT_ROLE_MESSAGE);
  }
}

function lockClause(options: AccessOptions): string {
  if (!options.lock) return '';
  if (!options.transaction) {
    throw new Error('AccessOptions.lock requires a transaction');
  }
  return '\n       FOR UPDATE';
}
