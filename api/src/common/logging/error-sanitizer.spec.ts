import { Writable } from 'node:stream';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { sanitizeError } from './error-sanitizer';
import { buildPinoHttpOptions, stripQueryString } from './pino-http.options';

const SECRET_VALUE = 'seller-9876543210@example.com';

/** Mimics sequelize's UniqueConstraintError (own enumerable name/sql/parent/original/fields/errors). */
function sequelizeUniqueError(): Error {
  const parent = Object.assign(
    new Error(`Duplicate entry '${SECRET_VALUE}' for key 'users.email'`),
    {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlMessage: `Duplicate entry '${SECRET_VALUE}' for key 'users.email'`,
      sql: `INSERT INTO users (email) VALUES ('${SECRET_VALUE}')`,
    },
  );
  const err = new Error(`Validation error: ${SECRET_VALUE}`);
  return Object.assign(err, {
    name: 'SequelizeUniqueConstraintError',
    sql: parent.sql,
    parameters: [SECRET_VALUE],
    parent,
    original: parent,
    fields: { email: SECRET_VALUE },
    errors: [{ message: 'email must be unique', value: SECRET_VALUE }],
    value: SECRET_VALUE,
  });
}

/** Mimics a raw mysql2 driver error. */
function mysql2Error(): Error {
  return Object.assign(
    new Error(`Duplicate entry '${SECRET_VALUE}' for key 'users.email'`),
    {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      sqlMessage: `Duplicate entry '${SECRET_VALUE}' for key 'users.email'`,
      sql: `INSERT INTO users (email) VALUES ('${SECRET_VALUE}')`,
    },
  );
}

describe('sanitizeError', () => {
  it('keeps type, message, stack and code of an ordinary error and drops other props', () => {
    const err = Object.assign(new TypeError('cannot read x'), {
      code: 'E_X',
      value: SECRET_VALUE,
      details: { email: SECRET_VALUE },
      cause: new Error(SECRET_VALUE),
    });

    const out = sanitizeError(err);

    expect(Object.keys(out).sort()).toEqual([
      'code',
      'message',
      'stack',
      'type',
    ]);
    expect(out.type).toBe('TypeError');
    expect(out.message).toBe('cannot read x');
    expect(out.code).toBe('E_X');
    expect(out.stack).toMatch(/^TypeError: cannot read x\n\s+at /);
    expect(JSON.stringify(out)).not.toContain(SECRET_VALUE);
  });

  it('reduces a Sequelize error to name/code with a generic message and scrubbed stack', () => {
    const out = sanitizeError(sequelizeUniqueError());

    expect(out).toEqual({
      type: 'SequelizeUniqueConstraintError',
      message: 'Database error (SequelizeUniqueConstraintError)',
      code: 'ER_DUP_ENTRY',
      stack: expect.stringMatching(
        /^SequelizeUniqueConstraintError: Database error \(SequelizeUniqueConstraintError\)\n\s+at /,
      ) as string,
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain(SECRET_VALUE);
    expect(json).not.toContain('INSERT');
    expect(json).not.toContain('Duplicate entry');
  });

  it('treats mysql2 driver errors (sqlMessage/errno) as database errors', () => {
    const out = sanitizeError(mysql2Error());

    expect(out.type).toBe('Error');
    expect(out.message).toBe('Database error (Error)');
    expect(out.code).toBe('ER_DUP_ENTRY');
    expect(JSON.stringify(out)).not.toContain(SECRET_VALUE);
  });

  it('does not log thrown primitives', () => {
    expect(sanitizeError(SECRET_VALUE)).toEqual({
      type: 'string',
      message: 'Non-error value thrown',
    });
  });

  it('unwraps pino std-serialized errors and is idempotent', () => {
    const wrapped = pino.stdSerializers.wrapErrorSerializer(sanitizeError);
    const once = wrapped(sequelizeUniqueError()) as unknown;
    const twice = sanitizeError(once);

    expect(twice).toEqual(once);
    expect(JSON.stringify(once)).not.toContain(SECRET_VALUE);
  });
});

describe('buildPinoHttpOptions (real pino output)', () => {
  function capture(): { lines: string[]; stream: Writable } {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    return { lines, stream };
  }

  it('serializes any logged `err` through the sanitiser', () => {
    const { lines, stream } = capture();
    const { logger } = pinoHttp(buildPinoHttpOptions('info'), stream);

    logger.error({ err: sequelizeUniqueError() }, 'insert failed');

    const entry = JSON.parse(lines[0]) as { err: Record<string, unknown> };
    expect(Object.keys(entry.err).sort()).toEqual([
      'code',
      'message',
      'stack',
      'type',
    ]);
    expect(lines[0]).not.toContain(SECRET_VALUE);
    expect(lines[0]).not.toContain('INSERT');
  });

  it('redacts credential headers', () => {
    const { lines, stream } = capture();
    const { logger } = pinoHttp(buildPinoHttpOptions('info'), stream);
    const headers = {
      authorization: 'Bearer t0k3n',
      'proxy-authorization': 'Basic cHJveHk=',
      cookie: 'sid=abc',
      'x-api-key': 'k3y',
      'x-xsrf-token': 'xsrf',
      'x-csrf-token': 'csrf',
      'user-agent': 'jest',
    };

    logger.info({ req: { method: 'GET', url: '/x', headers } }, 'request');

    const entry = JSON.parse(lines[0]) as {
      req: { headers: Record<string, string> };
    };
    for (const name of Object.keys(headers).filter((h) => h !== 'user-agent')) {
      expect(entry.req.headers[name]).toBe('[REDACTED]');
    }
    expect(entry.req.headers['user-agent']).toBe('jest');
  });

  it('redacts the session and XSRF cookies (request) and Set-Cookie (response)', () => {
    const { lines, stream } = capture();
    const { logger } = pinoHttp(buildPinoHttpOptions('info'), stream);

    logger.info(
      {
        req: {
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            cookie: 'msaas_sid=s3ss10n-t0k3n; msaas_xsrf=xsrf-t0k3n',
            'x-xsrf-token': 'xsrf-t0k3n',
          },
        },
        res: {
          statusCode: 200,
          getHeaders: () => ({
            'set-cookie': ['msaas_sid=n3w-s3ss10n; HttpOnly'],
          }),
        },
      },
      'request completed',
    );

    expect(lines[0]).not.toContain('t0k3n');
    expect(lines[0]).not.toContain('n3w-s3ss10n');
    const entry = JSON.parse(lines[0]) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, unknown> };
    };
    expect(entry.req.headers.cookie).toBe('[REDACTED]');
    expect(entry.req.headers['x-xsrf-token']).toBe('[REDACTED]');
    expect(entry.res.headers['set-cookie']).toBe('[REDACTED]');
  });

  it('logs request URLs without their query string and drops the parsed query', () => {
    const { lines, stream } = capture();
    const { logger } = pinoHttp(buildPinoHttpOptions('info'), stream);

    logger.info(
      {
        req: {
          method: 'GET',
          originalUrl: '/api/v1/orders?email=a%40b.test&token=abc123',
          query: { email: 'a@b.test', token: 'abc123' },
          headers: {},
        },
      },
      'request',
    );

    const entry = JSON.parse(lines[0]) as { req: Record<string, unknown> };
    expect(entry.req.url).toBe('/api/v1/orders');
    expect(entry.req).not.toHaveProperty('query');
    expect(lines[0]).not.toContain('abc123');
    expect(lines[0]).not.toContain('a@b.test');
  });
});

describe('stripQueryString', () => {
  it.each([
    ['/a/b?x=1', '/a/b'],
    ['/a/b#frag', '/a/b'],
    ['/a?x=1#f', '/a'],
    ['/plain', '/plain'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(stripQueryString(input)).toBe(expected);
  });

  it('leaves non-strings unchanged', () => {
    expect(stripQueryString(undefined)).toBeUndefined();
  });
});
