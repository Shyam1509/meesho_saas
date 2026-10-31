import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { AuditLog } from '../database/models';

export type AuditAction =
  | 'workspace.created'
  | 'workspace.renamed'
  | 'seller_account.created'
  | 'seller_account.updated'
  | 'seller_account.disabled'
  | 'seller_account.enabled'
  | 'import.confirmed'
  | 'import.cancelled'
  | 'settlement_entry.matched'
  | 'settlement_entry.unmatched';

export interface AuditEntry {
  action: AuditAction;
  entityType:
    'workspace' | 'seller_account' | 'import_job' | 'settlement_entry';
  entityId: number;
  workspaceId: number;
  sellerAccountId?: number | null;
  /** null = system. */
  actorUserId: number | null;
  requestId: string | null;
  /** Changed fields only, before the change. Never secrets or full rows. */
  before?: Record<string, unknown> | null;
  /** Changed fields only, after the change. */
  after?: Record<string, unknown> | null;
}

/** Appends audit_logs rows. Always inside the caller's transaction, so the trail commits with the change. */
@Injectable()
export class AuditService {
  async record(entry: AuditEntry, transaction: Transaction): Promise<void> {
    await AuditLog.create(
      {
        action: entry.action,
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        workspaceId: entry.workspaceId,
        sellerAccountId: entry.sellerAccountId ?? null,
        actorUserId: entry.actorUserId,
        requestId: entry.requestId,
        beforeData: entry.before ?? null,
        afterData: entry.after ?? null,
      },
      { transaction },
    );
  }
}

/**
 * Splits a change into the before/after maps of the fields that actually change. `next` lists only
 * the fields the caller wants to set; fields equal to their current value are left out.
 */
export function changedFields<T extends object>(
  current: T,
  next: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    const value = next[key];
    if (value === undefined || value === current[key]) continue;
    before[key] = current[key];
    after[key] = value;
  }
  return { before, after };
}
