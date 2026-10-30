import type { NextFunction, Request, Response } from 'express';
import {
  type AuthCookieSettings,
  readCookie,
  setCookie,
  XSRF_COOKIE,
  xsrfCookieOptions,
} from '../auth-cookies';
import { generateOpaqueToken, isWellFormedToken } from '../opaque-token';

/**
 * Express middleware (app.use, after cookie-parser): any request without a well-formed msaas_xsrf
 * cookie gets a fresh one on its response, whatever the route or status. The SPA's first request
 * (GET /auth/me) therefore seeds the token it must echo in X-XSRF-TOKEN on later unsafe requests.
 */
export function createCsrfSeedMiddleware(settings: AuthCookieSettings) {
  const options = xsrfCookieOptions(settings);
  return function csrfSeedMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!isWellFormedToken(readCookie(req, XSRF_COOKIE))) {
      setCookie(res, XSRF_COOKIE, generateOpaqueToken(), options);
    }
    next();
  };
}
