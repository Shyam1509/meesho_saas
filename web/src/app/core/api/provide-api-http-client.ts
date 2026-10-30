import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';

import { XSRF_COOKIE_NAME, XSRF_HEADER_NAME } from '../auth/auth.models';
import { unauthorizedInterceptor } from '../auth/unauthorized.interceptor';

/**
 * `HttpClient` as the app uses it: fetch backend; Angular's XSRF interceptor copies the
 * `msaas_xsrf` cookie into `X-XSRF-TOKEN` on same-origin POST/PUT/PATCH/DELETE; a 401 from a
 * session-guarded call signs the user out (see `unauthorizedInterceptor`).
 */
export function provideApiHttpClient(): EnvironmentProviders {
  return provideHttpClient(
    withFetch(),
    withXsrfConfiguration({ cookieName: XSRF_COOKIE_NAME, headerName: XSRF_HEADER_NAME }),
    withInterceptors([unauthorizedInterceptor]),
  );
}
