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

  describe('production refuses whole-schema undo commands', () => {
    const savedArgv = process.argv;

    afterEach(() => {
      process.argv = savedArgv;
    });

    const withArgs = (...args: string[]) => {
      process.argv = ['node', 'sequelize-cli', ...args];
      return loadWith('meesho_prod');
    };

    it.each(['db:migrate:undo:all', 'db:seed:undo:all'])(
      'refuses %s before reading the connection settings',
      (command) => {
        const config = withArgs(command, '--debug');
        // Even with no DB variables at all, the refusal comes first.
        delete process.env.DB_HOST;
        expect(() => config.production).toThrow(
          `Refusing to run "${command}" with NODE_ENV=production`,
        );
      },
    );

    it('still allows db:migrate, db:migrate:status and a single db:migrate:undo', () => {
      for (const command of [
        'db:migrate',
        'db:migrate:status',
        'db:migrate:undo',
      ]) {
        expect(withArgs(command).production.database).toBe('meesho_prod');
      }
    });

    it('does not restrict undo:all outside production', () => {
      const config = withArgs('db:migrate:undo:all');
      expect(config.development.database).toBe('meesho_prod');
    });
  });
});
