import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { readCookie, XSRF_COOKIE, XSRF_HEADER } from '../auth-cookies';
import { checkCsrf } from './csrf-check';

export const CSRF_ORIGIN_MESSAGE = 'Request origin is not allowed.';
export const CSRF_TOKEN_MESSAGE = 'Missing or invalid CSRF token.';

/**
 * Global guard (registered before AuthGuard, so it runs first): every POST/PUT/PATCH/DELETE route,
 * public ones included, needs an allowed Origin (when one is sent) and a matching X-XSRF-TOKEN header.
 * Failure → 403.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const failure = checkCsrf({
      method: req.method,
      origin: req.headers.origin,
      cookieToken: readCookie(req, XSRF_COOKIE),
      headerToken: req.headers[XSRF_HEADER],
      allowedOrigins: this.config.corsOrigins,
    });
    if (failure === 'origin_not_allowed') {
      throw new ForbiddenException(CSRF_ORIGIN_MESSAGE);
    }
    if (failure === 'token_mismatch') {
      throw new ForbiddenException(CSRF_TOKEN_MESSAGE);
    }
    return true;
  }
}
