import { EnvValidationError, validateEnv } from './env.validation';

const SECRET = 'S3cr3t-Value-Never-Logged';

function validRaw(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3200',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_NAME: 'meesho_dev',
    DB_USER: 'meesho_app',
    DB_PASSWORD: SECRET,
    CORS_ORIGINS: 'http://localhost:4300, https://app.example.com',
    LOG_LEVEL: 'debug',
  };
}

function captureError(fn: () => unknown): EnvValidationError {
  try {
    fn();
  } catch (err) {
    if (err instanceof EnvValidationError) return err;
    throw err;
  }
  throw new Error('expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('returns typed config for a valid environment', () => {
    const config = validateEnv(validRaw());

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3200);
    expect(config.DB_PORT).toBe(3307);
    expect(typeof config.DB_PORT).toBe('number');
    expect(config.DB_HOST).toBe('127.0.0.1');
    expect(config.CORS_ORIGINS).toEqual([
      'http://localhost:4300',
      'https://app.example.com',
    ]);
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('applies defaults for PORT, CORS_ORIGINS and LOG_LEVEL', () => {
    const raw = validRaw();
    delete raw.PORT;
    delete raw.CORS_ORIGINS;
    raw.LOG_LEVEL = '';

    const config = validateEnv(raw);

    expect(config.PORT).toBe(3100);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:4300']);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('ignores unrelated variables', () => {
    const config = validateEnv({ ...validRaw(), PATH: '/usr/bin', HOME: '/x' });
    expect(config).not.toHaveProperty('PATH');
  });

  it('throws naming DB_HOST when it is missing', () => {
    const raw = validRaw();
    delete raw.DB_HOST;

    const error = captureError(() => validateEnv(raw));

    expect(error.variables).toEqual(['DB_HOST']);
    expect(error.message).toContain('DB_HOST');
  });

  it('treats an empty DB_HOST as missing', () => {
    const error = captureError(() =>
      validateEnv({ ...validRaw(), DB_HOST: '  ' }),
    );
    expect(error.variables).toEqual(['DB_HOST']);
  });

  it('throws for an unsupported NODE_ENV', () => {
    const error = captureError(() =>
      validateEnv({ ...validRaw(), NODE_ENV: 'staging-xyz' }),
    );

    expect(error.variables).toEqual(['NODE_ENV']);
    expect(error.message).toContain('NODE_ENV');
  });

  it('never includes variable values in the error message', () => {
    const raw = {
      ...validRaw(),
      NODE_ENV: 'staging-xyz',
      DB_PORT: 'port-value-abc',
      CORS_ORIGINS: 'ftp://bad-origin-value',
      DB_PASSWORD: '',
    };
    delete (raw as Record<string, string>).DB_HOST;

    const error = captureError(() => validateEnv(raw));

    expect(error.variables.sort()).toEqual(
      ['CORS_ORIGINS', 'DB_HOST', 'DB_PASSWORD', 'DB_PORT', 'NODE_ENV'].sort(),
    );
    for (const value of [
      'staging-xyz',
      'port-value-abc',
      'ftp://bad-origin-value',
      SECRET,
      '127.0.0.1',
      'meesho_app',
    ]) {
      expect(error.message).not.toContain(value);
    }
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    expect(
      captureError(() => validateEnv({ ...validRaw(), PORT: 'abc' })).variables,
    ).toEqual(['PORT']);
    expect(
      captureError(() => validateEnv({ ...validRaw(), PORT: '70000' }))
        .variables,
    ).toEqual(['PORT']);
  });

  describe('test-database guard', () => {
    it('rejects NODE_ENV=test with a DB_NAME not ending in _test, naming DB_NAME only', () => {
      const error = captureError(() =>
        validateEnv({ ...validRaw(), NODE_ENV: 'test', DB_NAME: 'meesho_dev' }),
      );

      expect(error.variables).toEqual(['DB_NAME']);
      expect(error.message).toContain('DB_NAME');
      expect(error.message).toContain('_test');
      expect(error.message).not.toContain('meesho_dev');
    });

    it('rejects a name that merely contains _test', () => {
      const error = captureError(() =>
        validateEnv({
          ...validRaw(),
          NODE_ENV: 'test',
          DB_NAME: 'meesho_test_copy',
        }),
      );
      expect(error.variables).toEqual(['DB_NAME']);
    });

    it('accepts NODE_ENV=test with a *_test database', () => {
      const config = validateEnv({
        ...validRaw(),
        NODE_ENV: 'test',
        DB_NAME: 'meesho_test',
      });
      expect(config.DB_NAME).toBe('meesho_test');
    });

    it('does not apply outside NODE_ENV=test', () => {
      expect(
        validateEnv({
          ...validRaw(),
          NODE_ENV: 'production',
          DB_NAME: 'meesho',
        }).DB_NAME,
      ).toBe('meesho');
    });
  });
});
