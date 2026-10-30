import type { CookieOptions, Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';

/**
 * Cookie and header names shared with the web app. Prefixed `msaas_` so cookies of other apps on the
 * same host (cookies are not port-scoped) never collide.
 */
export const SESSION_COOKIE = 'msaas_sid';
/** Session cookie name when cookies are Secure: the __Host- prefix pins it to this host, Path=/. */
export const SECURE_SESSION_COOKIE = '__Host-msaas_sid';
/** Readable (non-HttpOnly) double-submit CSRF cookie; Angular copies it into X-XSRF-TOKEN. */
export const XSRF_COOKIE = 'msaas_xsrf';
/** Lower-case, as Node exposes request headers. */
export const XSRF_HEADER = 'x-xsrf-token';

export interface AuthCookieSettings {
  /** Secure flag on both cookies; also selects the __Host- session cookie name. */
  secure: boolean;
  /** Max-Age of both cookies in milliseconds: the absolute session lifetime. */
  maxAgeMs: number;
}

export function authCookieSettings(
  config: AppConfigService,
): AuthCookieSettings {
  return {
    secure: config.cookieSecure,
    maxAgeMs: config.sessionAbsoluteHours * 60 * 60 * 1000,
  };
}

export function sessionCookieName(settings: AuthCookieSettings): string {
  return settings.secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

/** HttpOnly, SameSite=Strict, Path=/, no Domain (required by the __Host- prefix). */
export function sessionCookieOptions(
  settings: AuthCookieSettings,
): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: settings.maxAgeMs,
  };
}

/** Same as the session cookie but readable by the SPA's JavaScript (that is the point of double submit). */
export function xsrfCookieOptions(settings: AuthCookieSettings): CookieOptions {
  return { ...sessionCookieOptions(settings), httpOnly: false };
}

/** A cookie value parsed by cookie-parser, or undefined when absent / not a non-empty string. */
export function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (!cookies || typeof cookies !== 'object') return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Sets a cookie, first dropping any Set-Cookie for the same name already on the response (e.g. the
 * XSRF seed middleware's), so the browser receives exactly one value.
 */
export function setCookie(
  res: Response,
  name: string,
  value: string,
  options: CookieOptions,
): void {
  const current = res.getHeader('Set-Cookie');
  const list = Array.isArray(current)
    ? current
    : typeof current === 'string'
      ? [current]
      : [];
  const others = list.filter((cookie) => !cookie.startsWith(`${name}=`));
  if (others.length !== list.length) res.setHeader('Set-Cookie', others);
  res.cookie(name, value, options);
}

/** Expires a cookie (Express 5 ignores maxAge here and sends an epoch Expires). */
export function clearCookie(
  res: Response,
  name: string,
  options: CookieOptions,
): void {
  const withoutMaxAge: CookieOptions = { ...options };
  delete withoutMaxAge.maxAge;
  res.clearCookie(name, withoutMaxAge);
}
