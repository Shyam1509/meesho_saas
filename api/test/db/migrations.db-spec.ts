import type { Sequelize } from 'sequelize-typescript';
import {
  createTestSequelize,
  DOMAIN_TABLES,
  listTables,
  MIGRATIONS,
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
    // Exactly the known migration files, in order.
    expect(applied).toEqual([...MIGRATIONS]);
    // One create migration per table, in dependency order.
    expect(
      applied
        .filter((name) => /^\d{14}-create-/.test(name))
        .map((name) => name.replace(/^\d{14}-create-|\.js$/g, '')),
    ).toEqual(DOMAIN_TABLES.map((table) => table.replace(/_/g, '-')));
  }

  async function importJobColumns(): Promise<string[]> {
    const rows = await select<{ col: string }>(
      sequelize,
      `SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_jobs'
       ORDER BY ORDINAL_POSITION`,
    );
    return rows.map((r) => r.col);
  }

  it('undo:all -> migrate -> undo:all -> migrate', async () => {
    runSequelizeCli('db:migrate:undo:all');
    await expectFullyRolledBack();

    const firstUp = runSequelizeCli('db:migrate');
    expect(firstUp.match(/: migrated \(/g)).toHaveLength(MIGRATIONS.length);
    await expectFullyMigrated();

    const status = runSequelizeCli('db:migrate:status');
    expect(status.match(/^up /gm)).toHaveLength(MIGRATIONS.length);
    expect(status).not.toMatch(/^down /m);

    const undo = runSequelizeCli('db:migrate:undo:all');
    expect(undo.match(/: reverted \(/g)).toHaveLength(MIGRATIONS.length);
    await expectFullyRolledBack();

    runSequelizeCli('db:migrate');
    await expectFullyMigrated();
  }, 180_000);

  it('M4 column migrations: each undo removes exactly its columns, migrate restores them', async () => {
    const before = await importJobColumns();
    // data_as_of + preview_summary right after report_period_end; history_only_count after unchanged_count.
    const end = before.indexOf('report_period_end');
    expect(before.slice(end, end + 3)).toEqual([
      'report_period_end',
      'data_as_of',
      'preview_summary',
    ]);
    const unchanged = before.indexOf('unchanged_count');
    expect(before.slice(unchanged, unchanged + 2)).toEqual([
      'unchanged_count',
      'history_only_count',
    ]);

    const undo17 = runSequelizeCli('db:migrate:undo');
    expect(undo17).toContain(
      '20261030000017-add-import-jobs-history-only-count: reverted',
    );
    const after17 = before.filter((c) => c !== 'history_only_count');
    expect(await importJobColumns()).toEqual(after17);

    const undo16 = runSequelizeCli('db:migrate:undo');
    expect(undo16).toContain(
      '20261030000016-add-import-jobs-data-as-of-and-preview: reverted',
    );
    expect(await importJobColumns()).toEqual(
      after17.filter((c) => c !== 'data_as_of' && c !== 'preview_summary'),
    );
    expect(await listTables(sequelize)).toEqual(migratedTables);

    runSequelizeCli('db:migrate');
    expect(await importJobColumns()).toEqual(before);
    await expectFullyMigrated();
  }, 120_000);
});
