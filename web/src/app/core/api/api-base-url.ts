import { InjectionToken } from '@angular/core';

/**
 * Base URL for every call to the Meesho Seller SaaS API.
 * Defaults to the same-origin `/api/v1` path; the dev server proxies `/api` to the API
 * (see `proxy.conf.json`). Override by providing this token in `app.config.ts`.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api/v1',
});
