import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import {
  type AuthCookieSettings,
  authCookieSettings,
  clearCookie,
  readCookie,
  sessionCookieName,
  sessionCookieOptions,
  setCookie,
  XSRF_COOKIE,
  xsrfCookieOptions,
} from './auth-cookies';
import { generateOpaqueToken, isWellFormedToken } from './opaque-token';

/** Reads and writes the session and XSRF cookies with the configured flags. */
@Injectable()
export class AuthCookieService {
  constructor(private readonly config: AppConfigService) {}

  get settings(): AuthCookieSettings {
    return authCookieSettings(this.config);
  }

  get sessionCookieName(): string {
    return sessionCookieName(this.settings);
  }

  readSessionToken(req: Request): string | undefined {
    return readCookie(req, this.sessionCookieName);
  }

  setSession(res: Response, token: string): void {
    setCookie(
      res,
      this.sessionCookieName,
      token,
      sessionCookieOptions(this.settings),
    );
  }

  clearSession(res: Response): void {
    clearCookie(
      res,
      this.sessionCookieName,
      sessionCookieOptions(this.settings),
    );
  }

  /** Issues a new XSRF token (login, register, logout rotate it). */
  rotateXsrf(res: Response): void {
    setCookie(
      res,
      XSRF_COOKIE,
      generateOpaqueToken(),
      xsrfCookieOptions(this.settings),
    );
  }

  /** (Re)sends the request's XSRF token, or a new one if it has none, without breaking other tabs. */
  ensureXsrf(req: Request, res: Response): void {
    const current = readCookie(req, XSRF_COOKIE);
    setCookie(
      res,
      XSRF_COOKIE,
      isWellFormedToken(current) ? current : generateOpaqueToken(),
      xsrfCookieOptions(this.settings),
    );
  }
}
