import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth.types';
import { AuthCookieService } from './auth-cookie.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionService } from './session.service';

export const AUTH_REQUIRED_MESSAGE = 'Authentication required.';

/**
 * Global default-deny guard: every route needs a valid session cookie unless marked @Public().
 * No/invalid/expired/revoked session or a disabled user → 401. On success, req.auth holds the user.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.readSessionToken(req);
    const auth = token ? await this.sessions.authenticate(token) : null;
    if (!auth) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    req.auth = auth;
    return true;
  }
}
