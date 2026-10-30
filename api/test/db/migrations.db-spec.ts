import type { Sequelize } from 'sequelize-typescript';
import {
  createTestSequelize,
  DOMAIN_TABLES,
  listTables,
  select,
} from './db-helpers';
import { runSequelizeCli } from './sequelize-cli';

/**
 * Clean-database round trip through the real sequelize-cli: undo everything, migrate, undo everything,
 * migrate again. Leaves meesho_test fully migrated.
 */
describe('migrations: clean migrate + full rollback (meesho_test)', () => {
  let sequelize: Sequelize;
  const migratedTables = [...DOMAIN_TABLES, 'sequelize_meta'].sort();

  beforeAll(() => {
    sequelize = createTestSequelize(false);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  async function appliedMigrations(): Promise<string[]> {
    const rows = await select<{ name: string }>(
      sequelize,
      'SELECT name FROM sequelize_meta ORDER BY name',
    );
    return rows.map((r) => r.name);
  }

  async function constraintCount(): Promise<number> {
    const [row] = await select<{ n: number }>(
      sequelize,
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME <> 'sequelize_meta'`,
    );
    return Number(row.n);
  }

  async function expectFullyRolledBack(): Promise<void> {
    expect(await listTables(sequelize)).toEqual(['sequelize_meta']);
    expect(await appliedMigrations()).toEqual([]);
    expect(await constraintCount()).toBe(0);
  }

  async function expectFullyMigrated(): Promise<void> {
    expect(await listTables(sequelize)).toEqual(migratedTables);
    const applied = await appliedMigrations();
    expect(applied).toHaveLength(DOMAIN_TABLES.length);
    // One migration per table, in dependency order.
    expect(
      applied.map((name) => name.replace(/^\d{14}-create-|\.js$/g, '')),
    ).toEqual(DOMAIN_TABLES.map((table) => table.replace(/_/g, '-')));
  }

  it('undo:all -> migrate -> undo:all -> migrate', async () => {
    runSequelizeCli('db:migrate:undo:all');
    await expectFullyRolledBack();

    const firstUp = runSequelizeCli('db:migrate');
    expect(firstUp.match(/: migrated \(/g)).toHaveLength(DOMAIN_TABLES.length);
    await expectFullyMigrated();

    const status = runSequelizeCli('db:migrate:status');
    expect(status.match(/^up /gm)).toHaveLength(DOMAIN_TABLES.length);
    expect(status).not.toMatch(/^down /m);

    const undo = runSequelizeCli('db:migrate:undo:all');
    expect(undo.match(/: reverted \(/g)).toHaveLength(DOMAIN_TABLES.length);
    await expectFullyRolledBack();

    runSequelizeCli('db:migrate');
    await expectFullyMigrated();
  }, 180_000);
});
