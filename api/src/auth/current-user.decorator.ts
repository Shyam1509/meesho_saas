import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { getRequestId } from '../common/logging/request-id';
import type {
  Actor,
  AuthenticatedRequest,
  AuthenticatedUser,
} from './auth.types';

function authOf(ctx: ExecutionContext): {
  req: AuthenticatedRequest;
  user: AuthenticatedUser;
} {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.auth) throw new UnauthorizedException('Authentication required.');
  return { req, user: req.auth.user };
}

/**
 * The user AuthGuard resolved for this request. Only valid on non-public routes; throws 401 if the
 * guard did not run (a wiring mistake), so a handler can never act for nobody.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    authOf(ctx).user,
);

/** The signed-in user's id plus this request's id: what services need to authorise and audit a change. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => {
    const { req, user } = authOf(ctx);
    return { userId: user.id, requestId: getRequestId(req) };
  },
);
