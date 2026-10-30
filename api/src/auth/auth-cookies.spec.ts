import type { Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';
import {
  authCookieSettings,
  readCookie,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  sessionCookieName,
  sessionCookieOptions,
  setCookie,
  XSRF_COOKIE,
  xsrfCookieOptions,
} from './auth-cookies';

function fakeResponse(initial?: string[]) {
  const headers: Record<string, unknown> = {};
  if (initial) headers['set-cookie'] = initial;
  const res = {
    getHeader: (name: string) => headers[name.toLowerCase()],
    setHeader: (name: string, value: unknown) => {
      headers[name.toLowerCase()] = value;
    },
    cookie: (name: string, value: string) => {
      const list = (headers['set-cookie'] as string[] | undefined) ?? [];
      headers['set-cookie'] = [...list, `${name}=${value}; Path=/`];
    },
  };
  return { res: res as unknown as Response, headers };
}

describe('auth cookies', () => {
  it('settings come from COOKIE_SECURE and SESSION_ABSOLUTE_HOURS', () => {
    const config = {
      cookieSecure: true,
      sessionAbsoluteHours: 168,
    } as AppConfigService;
    expect(authCookieSettings(config)).toEqual({
      secure: true,
      maxAgeMs: 168 * 3_600_000,
    });
  });

  it('uses the __Host- session cookie name only when secure', () => {
    expect(sessionCookieName({ secure: false, maxAgeMs: 1 })).toBe(
      SESSION_COOKIE,
    );
    expect(sessionCookieName({ secure: true, maxAgeMs: 1 })).toBe(
      SECURE_SESSION_COOKIE,
    );
    expect([SESSION_COOKIE, SECURE_SESSION_COOKIE, XSRF_COOKIE]).toEqual([
      'msaas_sid',
      '__Host-msaas_sid',
      'msaas_xsrf',
    ]);
  });

  it('session cookie: HttpOnly, SameSite=Strict, Path=/, no Domain, Max-Age = absolute lifetime', () => {
    const options = sessionCookieOptions({ secure: true, maxAgeMs: 5000 });
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 5000,
    });
    expect(options).not.toHaveProperty('domain');
  });

  it('XSRF cookie is readable by JavaScript, otherwise identical', () => {
    expect(xsrfCookieOptions({ secure: false, maxAgeMs: 5000 })).toEqual({
      httpOnly: false,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: 5000,
    });
  });

  it('readCookie returns non-empty string values only', () => {
    const req = (cookies: unknown) => ({ cookies }) as unknown as Request;
    expect(readCookie(req({ a: 'x' }), 'a')).toBe('x');
    expect(readCookie(req({ a: '' }), 'a')).toBeUndefined();
    expect(readCookie(req({ a: { j: 1 } }), 'a')).toBeUndefined();
    expect(readCookie(req(undefined), 'a')).toBeUndefined();
  });

  it('setCookie replaces an earlier Set-Cookie of the same name and keeps the others', () => {
    const { res, headers } = fakeResponse([
      'msaas_xsrf=old; Path=/',
      'other=1; Path=/',
    ]);

    setCookie(res, 'msaas_xsrf', 'new', { path: '/' });

    expect(headers['set-cookie']).toEqual([
      'other=1; Path=/',
      'msaas_xsrf=new; Path=/',
    ]);
  });
});
