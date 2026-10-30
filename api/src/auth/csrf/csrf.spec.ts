import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { AppConfigService } from '../../config/app-config.service';
import { generateOpaqueToken } from '../opaque-token';
import { checkCsrf, type CsrfRequestFacts } from './csrf-check';
import {
  CSRF_ORIGIN_MESSAGE,
  CSRF_TOKEN_MESSAGE,
  CsrfGuard,
} from './csrf.guard';
import { createCsrfSeedMiddleware } from './csrf-seed.middleware';

const ALLOWED = ['http://localhost:4300'];
const TOKEN = generateOpaqueToken();

function facts(overrides: Partial<CsrfRequestFacts> = {}): CsrfRequestFacts {
  return {
    method: 'POST',
    origin: undefined,
    cookieToken: TOKEN,
    headerToken: TOKEN,
    allowedOrigins: ALLOWED,
    ...overrides,
  };
}

describe('checkCsrf', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'never blocks a safe %s request, even without token or with a foreign origin',
    (method) => {
      expect(
        checkCsrf(
          facts({
            method,
            cookieToken: undefined,
            headerToken: undefined,
            origin: 'http://evil.example',
          }),
        ),
      ).toBeNull();
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])(
    'accepts %s with matching cookie and header and no Origin',
    (method) => {
      expect(checkCsrf(facts({ method }))).toBeNull();
    },
  );

  it('accepts an allowed Origin', () => {
    expect(checkCsrf(facts({ origin: 'http://localhost:4300' }))).toBeNull();
  });

  it.each([
    ['foreign origin', 'http://evil.example'],
    ['"null" origin', 'null'],
    ['allowed origin with a path', 'http://localhost:4300/x'],
    ['different port', 'http://localhost:4301'],
    ['repeated header', ['http://localhost:4300', 'http://evil.example']],
  ])('rejects a %s', (_label, origin) => {
    expect(checkCsrf(facts({ origin }))).toBe('origin_not_allowed');
  });

  it.each([
    ['missing header', { headerToken: undefined }],
    ['missing cookie', { cookieToken: undefined }],
    ['different token', { headerToken: generateOpaqueToken() }],
    ['malformed equal values', { cookieToken: 'abc', headerToken: 'abc' }],
    ['repeated header', { headerToken: [TOKEN, TOKEN] }],
  ])('rejects a %s', (_label, overrides) => {
    expect(checkCsrf(facts(overrides))).toBe('token_mismatch');
  });

  it('checks the origin before the token', () => {
    expect(
      checkCsrf(facts({ origin: 'http://evil.example', headerToken: '' })),
    ).toBe('origin_not_allowed');
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard({ corsOrigins: ALLOWED } as AppConfigService);

  function context(req: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('passes a valid unsafe request', () => {
    const req = {
      method: 'POST',
      headers: { 'x-xsrf-token': TOKEN, origin: 'http://localhost:4300' },
      cookies: { msaas_xsrf: TOKEN },
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('403 with distinct messages for origin and token failures', () => {
    const badOrigin = {
      method: 'DELETE',
      headers: { 'x-xsrf-token': TOKEN, origin: 'http://evil.example' },
      cookies: { msaas_xsrf: TOKEN },
    };
    const noToken = { method: 'PATCH', headers: {}, cookies: {} };

    expect(() => guard.canActivate(context(badOrigin))).toThrow(
      new ForbiddenException(CSRF_ORIGIN_MESSAGE),
    );
    expect(() => guard.canActivate(context(noToken))).toThrow(
      new ForbiddenException(CSRF_TOKEN_MESSAGE),
    );
  });
});

describe('createCsrfSeedMiddleware', () => {
  const app = express();
  app.use(cookieParser());
  app.use(createCsrfSeedMiddleware({ secure: false, maxAgeMs: 60_000 }));
  app.get('/x', (_req, res) => {
    res.status(204).end();
  });

  const xsrfCookies = (res: request.Response): string[] =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .filter((c) => c.startsWith('msaas_xsrf='));

  it('seeds a readable SameSite=Strict token when the request has none', async () => {
    const res = await request(app).get('/x').expect(204);
    const [cookie] = xsrfCookies(res);

    expect(cookie).toMatch(/^msaas_xsrf=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
  });

  it('leaves a well-formed existing token alone', async () => {
    const res = await request(app)
      .get('/x')
      .set('Cookie', `msaas_xsrf=${TOKEN}`)
      .expect(204);
    expect(xsrfCookies(res)).toEqual([]);
  });

  it('replaces a malformed token', async () => {
    const res = await request(app)
      .get('/x')
      .set('Cookie', 'msaas_xsrf=bogus')
      .expect(204);
    expect(xsrfCookies(res)).toHaveLength(1);
  });
});
