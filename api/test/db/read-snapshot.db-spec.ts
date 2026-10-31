import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { readSnapshot } from '../../src/common/sql/read-snapshot';
import { User } from '../../src/database/models';
import { createTestSequelize } from './db-helpers';

/** MySQL ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION. */
const READ_ONLY_ERRNO = 1792;

async function errnoOf(action: Promise<unknown>): Promise<number | null> {
  try {
    await action;
    return null;
  } catch (err) {
    return (err as { parent?: { errno?: number } }).parent?.errno ?? -1;
  }
}

/**
 * readSnapshot (the multi-query reads of the M5 lists and overview) against the migrated meesho_test: the
 * transaction really is READ ONLY and REPEATABLE READ (one snapshot from its first read), and the
 * characteristics do not leak into the connection's next transaction.
 */
describe('readSnapshot (meesho_test)', () => {
  let sequelize: Sequelize;

  beforeAll(() => {
    sequelize = createTestSequelize();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('is READ ONLY: a write inside fails with errno 1792', async () => {
    const errno = await readSnapshot(sequelize, (transaction) =>
      errnoOf(
        sequelize.query('UPDATE users SET status = status WHERE id = 0', {
          type: QueryTypes.UPDATE,
          transaction,
        }),
      ),
    );
    expect(errno).toBe(READ_ONLY_ERRNO);
  });

  it('every read sees the snapshot of the first one, even after another connection commits', async () => {
    const email = `snapshot-${Date.now().toString(36)}@example.test`;
    const count = (transaction?: Transaction) =>
      sequelize
        .query<{ n: number }>(
          'SELECT COUNT(*) AS n FROM users WHERE email = ?',
          { type: QueryTypes.SELECT, replacements: [email], transaction },
        )
        .then(([row]) => Number(row.n));
    try {
      const seen = await readSnapshot(sequelize, async (transaction) => {
        const before = await count(transaction);
        // Committed on the pool's other connection (autocommit) while the snapshot is open.
        await User.create({ email, passwordHash: 'not-a-real-hash' });
        const after = await count(transaction);
        return [before, after];
      });
      expect(seen).toEqual([0, 0]);
      expect(await count()).toBe(1);
    } finally {
      await User.destroy({ where: { email } });
    }
  });

  it("does not leak: the connection's next transactions can write again", async () => {
    await readSnapshot(sequelize, async (transaction) => {
      await sequelize.query('SELECT 1', { transaction });
    });
    for (let i = 0; i < 3; i += 1) {
      const errno = await sequelize.transaction((transaction) =>
        errnoOf(
          sequelize.query('UPDATE users SET status = status WHERE id = 0', {
            type: QueryTypes.UPDATE,
            transaction,
          }),
        ),
      );
      expect(errno).toBeNull();
    }
  });
});
