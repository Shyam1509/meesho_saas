import { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

/**
 * Sequelize sends `SET TRANSACTION ISOLATION LEVEL <isolationLevel>;` right before `START TRANSACTION;`
 * (MySQL: both apply to that next transaction only). `SET TRANSACTION` takes a list of characteristics, so
 * this value makes the transaction REPEATABLE READ *and* READ ONLY. Asserted against MySQL by
 * test/db/read-snapshot.db-spec.ts (a write inside fails; a commit elsewhere is not seen).
 */
const REPEATABLE_READ_READ_ONLY =
  `${Transaction.ISOLATION_LEVELS.REPEATABLE_READ}, READ ONLY` as Transaction.ISOLATION_LEVELS;

/**
 * Runs several reads (a page + its total + its totals, an overview's counts) in ONE read-only
 * REPEATABLE READ transaction: InnoDB takes the snapshot at its first read and every later read sees that
 * same snapshot, so a list, its total and its sums can never disagree because an import committed in
 * between. Pass the transaction to every query inside `work`.
 */
export function readSnapshot<T>(
  sequelize: Sequelize,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return sequelize.transaction(
    { isolationLevel: REPEATABLE_READ_READ_ONLY },
    work,
  );
}
