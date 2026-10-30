import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

import { AuthStateService } from './auth-state.service';
import { DEFAULT_SIGNED_IN_URL } from './auth.models';
import { returnUrlParams, safeReturnUrl } from './return-url';

/** Signed-in users only; anyone else goes to `/login?returnUrl=<where they were going>`. */
export const authGuard: CanActivateFn & CanActivateChildFn = async (_route, state) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  await auth.ensureLoaded();
  return auth.isAuthenticated()
    ? true
    : router.createUrlTree(['/login'], { queryParams: returnUrlParams(state.url) });
};

/** Signed-out visitors only (sign-in, registration); a signed-in user goes to their return URL. */
export const guestGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) {
    return true;
  }
  return router.parseUrl(
    safeReturnUrl(route.queryParamMap.get('returnUrl')) ?? DEFAULT_SIGNED_IN_URL,
  );
};

/** `/register` only while `GET /auth/config` says registration is open; otherwise `/login`. */
export const registrationEnabledGuard: CanActivateFn = async () => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  return (await auth.loadConfig()) ? true : router.createUrlTree(['/login']);
};
