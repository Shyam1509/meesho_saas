import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route (or controller) out of the global AuthGuard. Everything else requires a valid session
 * (default deny). CSRF checks still apply to public POST/PUT/PATCH/DELETE routes.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
