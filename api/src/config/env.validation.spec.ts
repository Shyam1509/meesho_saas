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
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:4310']);
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

  describe('auth settings', () => {
    it('defaults: registration off, insecure cookies outside production, 12 h idle, 7 d absolute, 10/min', () => {
      const config = validateEnv(validRaw());

      expect(config.AUTH_REGISTRATION_ENABLED).toBe(false);
      expect(config.COOKIE_SECURE).toBe(false);
      expect(config.SESSION_IDLE_MINUTES).toBe(720);
      expect(config.SESSION_ABSOLUTE_HOURS).toBe(168);
      expect(config.AUTH_RATE_LIMIT_PER_MINUTE).toBe(10);
    });

    it('COOKIE_SECURE defaults to true in production', () => {
      const config = validateEnv({ ...validRaw(), NODE_ENV: 'production' });
      expect(config.COOKIE_SECURE).toBe(true);
    });

    it('parses booleans case-insensitively and numbers', () => {
      const config = validateEnv({
        ...validRaw(),
        AUTH_REGISTRATION_ENABLED: 'TRUE',
        COOKIE_SECURE: 'true',
        SESSION_IDLE_MINUTES: '30',
        SESSION_ABSOLUTE_HOURS: '24',
        AUTH_RATE_LIMIT_PER_MINUTE: '50',
      });

      expect(config.AUTH_REGISTRATION_ENABLED).toBe(true);
      expect(config.COOKIE_SECURE).toBe(true);
      expect(config.SESSION_IDLE_MINUTES).toBe(30);
      expect(config.SESSION_ABSOLUTE_HOURS).toBe(24);
      expect(config.AUTH_RATE_LIMIT_PER_MINUTE).toBe(50);
    });

    it('rejects COOKIE_SECURE=false in production, naming COOKIE_SECURE only', () => {
      const error = captureError(() =>
        validateEnv({
          ...validRaw(),
          NODE_ENV: 'production',
          COOKIE_SECURE: 'false',
        }),
      );

      expect(error.variables).toEqual(['COOKIE_SECURE']);
      expect(error.message).toContain('COOKIE_SECURE=false is not allowed');
    });

    it('allows COOKIE_SECURE=false outside production', () => {
      expect(
        validateEnv({ ...validRaw(), COOKIE_SECURE: 'false' }).COOKIE_SECURE,
      ).toBe(false);
    });

    it.each([
      ['AUTH_REGISTRATION_ENABLED', 'yes'],
      ['COOKIE_SECURE', '1'],
      ['SESSION_IDLE_MINUTES', '5'],
      ['SESSION_IDLE_MINUTES', 'abc'],
      ['SESSION_ABSOLUTE_HOURS', '0'],
      ['AUTH_RATE_LIMIT_PER_MINUTE', '0'],
      ['AUTH_RATE_LIMIT_PER_MINUTE', '10001'],
    ])('rejects %s=%s', (name, value) => {
      expect(
        captureError(() => validateEnv({ ...validRaw(), [name]: value }))
          .variables,
      ).toEqual([name]);
    });

    it('rejects an idle timeout longer than the absolute lifetime', () => {
      const error = captureError(() =>
        validateEnv({
          ...validRaw(),
          SESSION_IDLE_MINUTES: '120',
          SESSION_ABSOLUTE_HOURS: '1',
        }),
      );

      expect(error.variables).toEqual(['SESSION_IDLE_MINUTES']);
    });
  });

  describe('import settings', () => {
    it('defaults: 10 MB per file, 50 000 rows', () => {
      const config = validateEnv(validRaw());
      expect(config.IMPORT_MAX_FILE_MB).toBe(10);
      expect(config.IMPORT_MAX_ROWS).toBe(50_000);
    });

    it('parses numbers, including the bounds', () => {
      expect(
        validateEnv({
          ...validRaw(),
          IMPORT_MAX_FILE_MB: '1',
          IMPORT_MAX_ROWS: '200000',
        }),
      ).toEqual(
        expect.objectContaining({
          IMPORT_MAX_FILE_MB: 1,
          IMPORT_MAX_ROWS: 200_000,
        }),
      );
      expect(
        validateEnv({
          ...validRaw(),
          IMPORT_MAX_FILE_MB: '50',
          IMPORT_MAX_ROWS: '1',
        }),
      ).toEqual(
        expect.objectContaining({ IMPORT_MAX_FILE_MB: 50, IMPORT_MAX_ROWS: 1 }),
      );
    });

    it.each([
      ['IMPORT_MAX_FILE_MB', '0'],
      ['IMPORT_MAX_FILE_MB', '51'],
      ['IMPORT_MAX_FILE_MB', '2.5'],
      ['IMPORT_MAX_FILE_MB', 'ten'],
      ['IMPORT_MAX_ROWS', '0'],
      ['IMPORT_MAX_ROWS', '200001'],
      ['IMPORT_MAX_ROWS', '-5'],
    ])('rejects %s=%s, naming only that variable', (name, value) => {
      expect(
        captureError(() => validateEnv({ ...validRaw(), [name]: value }))
          .variables,
      ).toEqual([name]);
    });
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
