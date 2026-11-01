import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { AuthStateService } from './auth-state.service';
import { returnUrlParams } from './return-url';

/** Calls whose 401 is an answer ("not signed in", "wrong password"), not an expired session. */
const SESSION_PROBE_PATHS = ['/auth/me', '/auth/login', '/auth/register'];

/**
 * A 401 from any other API call means the session ended (expired, revoked, user disabled):
 * forget the user and their stored workspace choice, and go to the sign-in page, which says
 * "Your session ended" and brings them back here afterwards. Only the first such 401 does this: a
 * late one from a request that was already in flight finds nobody signed in and is left alone, so
 * it cannot replace the return URL with the sign-in page's own.
 * The error still reaches the caller.
 */
export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) => {
  const baseUrl = inject(API_BASE_URL);
  // Resolved lazily: AuthStateService itself depends on HttpClient.
  const injector = inject(Injector);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        isSessionGuardedRequest(req.url, baseUrl)
      ) {
        const auth = injector.get(AuthStateService);
        if (auth.isAuthenticated()) {
          auth.expireSession();
          const router = injector.get(Router);
          void router.navigate(['/login'], { queryParams: returnUrlParams(router.url) });
        }
      }
      return throwError(() => error);
    }),
  );
};

function isSessionGuardedRequest(url: string, baseUrl: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  if (path !== baseUrl && !path.startsWith(`${baseUrl}/`)) {
    return false;
  }
  return !SESSION_PROBE_PATHS.includes(path.slice(baseUrl.length));
}
