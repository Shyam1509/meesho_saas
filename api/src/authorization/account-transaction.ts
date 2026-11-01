import { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { Actor } from '../auth/auth.types';
import { ApiException } from '../common/errors/api.exception';
import { isLockContention } from '../common/sql/lock-errors';
import type { WorkspaceRole } from '../database/models';
import type {
  AccountAccess,
  WorkspaceAccessService,
} from './workspace-access.service';

/** 409 for a lock wait timeout (1205) or deadlock (1213) on the account: nothing changed, retry. */
export const ACCOUNT_BUSY_MESSAGE =
  'An import or another change is running for this account; try again shortly.';

/**
 * Runs `work` in a READ COMMITTED transaction whose FIRST statement locks the seller account row (and
 * re-checks membership and role, SELECT ... FOR UPDATE): the same lock every import confirm takes first,
 * so the change is serialised with imports and every other locked change of the account, and sees what
 * they committed. A disabled account → 409 `disabledMessage`. Lock wait timeout (1205) or deadlock
 * (1213) → 409 ACCOUNT_BUSY_MESSAGE (everything rolled back, safe to retry).
 * Used by reconciliation changes (M5) and product / cost writes (M6).
 */
export async function inAccountTransaction<T>(
  sequelize: Sequelize,
  access: WorkspaceAccessService,
  actor: Actor,
  accountId: string,
  minRole: WorkspaceRole,
  disabledMessage: string,
  work: (
    account: AccountAccess['account'],
    transaction: Transaction,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (transaction) => {
        const { account } = await access.requireAccount(
          actor.userId,
          accountId,
          minRole,
          { transaction, lock: true },
        );
        if (account.status !== 'active') {
          throw new ApiException('CONFLICT', disabledMessage);
        }
        return work(account, transaction);
      },
    );
  } catch (err) {
    // Waited too long for the account lock (an import holds it) or lost a deadlock: rolled back, retry.
    if (isLockContention(err)) {
      throw new ApiException('CONFLICT', ACCOUNT_BUSY_MESSAGE);
    }
    throw err;
  }
}
