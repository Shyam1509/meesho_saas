/** MySQL ER_LOCK_WAIT_TIMEOUT: a row lock was not granted within innodb_lock_wait_timeout. */
export const ER_LOCK_WAIT_TIMEOUT = 1205;
/** MySQL ER_LOCK_DEADLOCK: InnoDB rolled the transaction back to break a deadlock. */
export const ER_LOCK_DEADLOCK = 1213;

const CONTENTION_ERRNOS: readonly number[] = [
  ER_LOCK_WAIT_TIMEOUT,
  ER_LOCK_DEADLOCK,
];

interface MysqlErrorLike {
  errno?: unknown;
  parent?: { errno?: unknown };
  original?: { errno?: unknown };
}

/**
 * Whether `err` is lock contention (lock wait timeout or deadlock): Sequelize wraps the mysql2 error as a
 * DatabaseError whose `parent` / `original` carry the errno. Nothing was changed (the statement, or for a
 * deadlock the whole transaction, was rolled back), so the request can simply be tried again.
 */
export function isLockContention(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as MysqlErrorLike;
  const errno = e.parent?.errno ?? e.original?.errno ?? e.errno;
  return typeof errno === 'number' && CONTENTION_ERRNOS.includes(errno);
}
