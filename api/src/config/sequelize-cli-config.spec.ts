/** Tests db/config.js (the sequelize-cli config), in particular the test-database guard. */
interface CliDbConfig {
  database: string;
  seederStorage: string;
  seederStorageTableName: string;
  migrationStorageTableName: string;
}

interface CliConfigModule {
  development: CliDbConfig;
  test: CliDbConfig;
  production: CliDbConfig;
}

const DB_VARS = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_USER: 'unit_user',
  DB_PASSWORD: 'unit-password',
};

function loadWith(dbName: string): CliConfigModule {
  // Explicit values win over anything dotenv loads from .env/.env.test.
  Object.assign(process.env, DB_VARS, { DB_NAME: dbName });
  let loaded: CliConfigModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<CliConfigModule>('../../db/config.js');
  });
  if (!loaded) throw new Error('db/config.js did not load');
  return loaded;
}

describe('db/config.js', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('test env rejects a DB_NAME without the _test suffix, naming DB_NAME only', () => {
    const config = loadWith('meesho_dev');

    let message = '';
    try {
      void config.test;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain('DB_NAME');
    expect(message).toContain('_test');
    expect(message).not.toContain('meesho_dev');
  });

  it('test env accepts a *_test database', () => {
    expect(loadWith('meesho_test').test.database).toBe('meesho_test');
  });

  it('development is not subject to the test guard and records seeders', () => {
    const dev = loadWith('meesho_dev').development;
    expect(dev.database).toBe('meesho_dev');
    expect(dev.migrationStorageTableName).toBe('sequelize_meta');
    expect(dev.seederStorage).toBe('sequelize');
    expect(dev.seederStorageTableName).toBe('sequelize_data');
  });
});
