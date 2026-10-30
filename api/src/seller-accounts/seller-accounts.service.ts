import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService, changedFields } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import type { ValidationErrorDetailDto } from '../common/errors/error-response.dto';
import { FieldConflictException } from '../common/errors/field-conflict.exception';
import { uniqueConflictDetails } from '../common/errors/unique-conflict';
import { SellerAccount, type SellerAccountStatus } from '../database/models';
import type {
  CreateSellerAccountDto,
  SellerAccountDto,
  UpdateSellerAccountDto,
} from './dto/seller-account.dto';

export const DUPLICATE_ACCOUNT_MESSAGE =
  'Another seller account in this workspace already uses this value.';
// Shown to people under the form field, so plain words rather than API field names.
export const DUPLICATE_DISPLAY_NAME_REASON =
  'Another seller account in this workspace already has this name.';
export const DUPLICATE_SUPPLIER_ID_REASON =
  'Another seller account in this workspace already has this supplier ID.';

/** Unique keys of seller_accounts that back an API field (see db/migrations/...-create-seller-accounts.js). */
const UNIQUE_KEY_FIELDS = {
  uq_seller_accounts_workspace_display_name: {
    field: 'displayName',
    reason: DUPLICATE_DISPLAY_NAME_REASON,
  },
  uq_seller_accounts_workspace_supplier: {
    field: 'meeshoSupplierId',
    reason: DUPLICATE_SUPPLIER_ID_REASON,
  },
} as const;

interface AccountRow {
  id: number;
  workspaceId: number;
  displayName: string;
  meeshoSupplierId: string | null;
  status: SellerAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface EditableFields {
  displayName?: string;
  meeshoSupplierId?: string | null;
}

export function toSellerAccountDto(account: AccountRow): SellerAccountDto {
  return {
    id: String(account.id),
    workspaceId: String(account.workspaceId),
    displayName: account.displayName,
    meeshoSupplierId: account.meeshoSupplierId,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Seller accounts of a workspace. Reads need membership, changes need the owner role; every query after
 * the access check uses the workspace/account ids it resolved. Accounts are disabled, never deleted.
 */
@Injectable()
export class SellerAccountsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: number, workspaceId: string): Promise<SellerAccountDto[]> {
    const { workspace } = await this.access.requireWorkspace(
      userId,
      workspaceId,
      'member',
    );
    const accounts = await SellerAccount.findAll({
      where: { workspaceId: workspace.id },
      order: [
        ['displayName', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    return accounts.map(toSellerAccountDto);
  }

  async create(
    actor: Actor,
    workspaceId: string,
    dto: CreateSellerAccountDto,
  ): Promise<SellerAccountDto> {
    return this.mapDuplicateKeys(() =>
      this.sequelize.transaction(async (transaction) => {
        const { workspace } = await this.access.requireWorkspace(
          actor.userId,
          workspaceId,
          'owner',
          { transaction, lock: true },
        );
        const values = {
          displayName: dto.displayName,
          meeshoSupplierId: dto.meeshoSupplierId ?? null,
        };
        await this.assertUnique(workspace.id, values, null, transaction);
        const account = await SellerAccount.create(
          { workspaceId: workspace.id, ...values },
          { transaction },
        );
        await this.audit.record(
          {
            action: 'seller_account.created',
            entityType: 'seller_account',
            entityId: account.id,
            workspaceId: workspace.id,
            sellerAccountId: account.id,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            after: { ...values, status: account.status },
          },
          transaction,
        );
        return toSellerAccountDto(account);
      }),
    );
  }

  async get(userId: number, accountId: string): Promise<SellerAccountDto> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    return toSellerAccountDto(account);
  }

  /**
   * Owner only. Audit: `seller_account.updated` for displayName/meeshoSupplierId changes and
   * `seller_account.disabled` / `.enabled` for a status change (changed fields only). No change → no write.
   */
  async update(
    actor: Actor,
    accountId: string,
    dto: UpdateSellerAccountDto,
  ): Promise<SellerAccountDto> {
    return this.mapDuplicateKeys(() =>
      this.sequelize.transaction(async (transaction) => {
        const { account } = await this.access.requireAccount(
          actor.userId,
          accountId,
          'owner',
          { transaction, lock: true },
        );
        const fields = changedFields<EditableFields>(
          {
            displayName: account.displayName,
            meeshoSupplierId: account.meeshoSupplierId,
          },
          {
            displayName: dto.displayName,
            meeshoSupplierId: dto.meeshoSupplierId,
          },
        );
        const fieldsChanged = Object.keys(fields.after).length > 0;
        const newStatus =
          dto.status !== undefined && dto.status !== account.status
            ? dto.status
            : undefined;
        if (!fieldsChanged && newStatus === undefined) {
          return toSellerAccountDto(account);
        }

        await this.assertUnique(
          account.workspaceId,
          fields.after,
          account.id,
          transaction,
        );
        await SellerAccount.update(
          { ...fields.after, ...(newStatus ? { status: newStatus } : {}) },
          { where: { id: account.id }, transaction },
        );

        const auditBase = {
          entityType: 'seller_account' as const,
          entityId: account.id,
          workspaceId: account.workspaceId,
          sellerAccountId: account.id,
          actorUserId: actor.userId,
          requestId: actor.requestId,
        };
        if (fieldsChanged) {
          await this.audit.record(
            {
              ...auditBase,
              action: 'seller_account.updated',
              before: fields.before,
              after: fields.after,
            },
            transaction,
          );
        }
        if (newStatus) {
          await this.audit.record(
            {
              ...auditBase,
              action:
                newStatus === 'disabled'
                  ? 'seller_account.disabled'
                  : 'seller_account.enabled',
              before: { status: account.status },
              after: { status: newStatus },
            },
            transaction,
          );
        }

        const updated = await SellerAccount.findByPk(account.id, {
          transaction,
        });
        return toSellerAccountDto(updated as SellerAccount);
      }),
    );
  }

  /** DELETE: disables the account (idempotent). Seller accounts are never hard-deleted. */
  disable(actor: Actor, accountId: string): Promise<SellerAccountDto> {
    return this.update(actor, accountId, { status: 'disabled' });
  }

  /** 409 with every field that collides with another account of the workspace (collation-aware). */
  private async assertUnique(
    workspaceId: number,
    values: EditableFields,
    excludeAccountId: number | null,
    transaction: Transaction,
  ): Promise<void> {
    const scope: WhereOptions<SellerAccount> =
      excludeAccountId === null
        ? { workspaceId }
        : { workspaceId, id: { [Op.ne]: excludeAccountId } };
    const details: ValidationErrorDetailDto[] = [];
    if (values.displayName !== undefined) {
      const taken = await SellerAccount.count({
        where: { ...scope, displayName: values.displayName },
        transaction,
      });
      if (taken > 0) {
        details.push({
          field: 'displayName',
          reasons: [DUPLICATE_DISPLAY_NAME_REASON],
        });
      }
    }
    if (values.meeshoSupplierId) {
      const taken = await SellerAccount.count({
        where: { ...scope, meeshoSupplierId: values.meeshoSupplierId },
        transaction,
      });
      if (taken > 0) {
        details.push({
          field: 'meeshoSupplierId',
          reasons: [DUPLICATE_SUPPLIER_ID_REASON],
        });
      }
    }
    if (details.length > 0) {
      throw new FieldConflictException(DUPLICATE_ACCOUNT_MESSAGE, details);
    }
  }

  /** A concurrent insert can still hit the unique key after assertUnique: report it as the same 409. */
  private async mapDuplicateKeys<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const details = uniqueConflictDetails(err, UNIQUE_KEY_FIELDS);
      if (details) {
        throw new FieldConflictException(DUPLICATE_ACCOUNT_MESSAGE, details);
      }
      throw err;
    }
  }
}
