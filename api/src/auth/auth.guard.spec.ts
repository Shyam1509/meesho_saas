import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthCookieService } from './auth-cookie.service';
import { AUTH_REQUIRED_MESSAGE, AuthGuard } from './auth.guard';
import type { AuthContext, AuthenticatedRequest } from './auth.types';
import { Public } from './public.decorator';
import type { SessionService } from './session.service';

class Routes {
  @Public()
  open(this: void): void {}

  closed(this: void): void {}
}

const AUTH: AuthContext = {
  sessionId: 3,
  user: { id: 1, email: 'a@b.test', displayName: null },
};

describe('AuthGuard', () => {
  let authenticate: jest.Mock;
  let readSessionToken: jest.Mock;
  let guard: AuthGuard;

  beforeEach(() => {
    authenticate = jest.fn();
    readSessionToken = jest.fn();
    guard = new AuthGuard(
      new Reflector(),
      { authenticate } as unknown as SessionService,
      { readSessionToken } as unknown as AuthCookieService,
    );
  });

  function context(
    handler: keyof Routes,
    req: Partial<AuthenticatedRequest> = {},
  ): ExecutionContext {
    return {
      getType: () => 'http',
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('lets @Public() routes through without looking at the session', async () => {
    await expect(guard.canActivate(context('open'))).resolves.toBe(true);
    expect(readSessionToken).not.toHaveBeenCalled();
  });

  it('401 "Authentication required." without a session cookie (default deny)', async () => {
    readSessionToken.mockReturnValue(undefined);
    await expect(guard.canActivate(context('closed'))).rejects.toEqual(
      new UnauthorizedException(AUTH_REQUIRED_MESSAGE),
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('401 when the session does not authenticate (expired, revoked, disabled user, ...)', async () => {
    readSessionToken.mockReturnValue('token');
    authenticate.mockResolvedValue(null);
    await expect(guard.canActivate(context('closed'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the auth context for a valid session', async () => {
    const req: Partial<AuthenticatedRequest> = {};
    readSessionToken.mockReturnValue('token');
    authenticate.mockResolvedValue(AUTH);

    await expect(guard.canActivate(context('closed', req))).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('token');
    expect(req.auth).toBe(AUTH);
  });
});
