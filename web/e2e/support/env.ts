import path from 'node:path';

/**
 * Where the suite's stack listens (never 3001, 3100, 4200, 4300 or 4310: those belong to the
 * developer's own servers and to unrelated projects).
 */
export const WEB_PORT = 4311;
export const API_PORT = 3101;
export const BASE_URL = `http://localhost:${WEB_PORT}`;
/** The web dev server proxies `/api` to the API (proxy.e2e.json), so the browser stays same-origin. */
export const API_PATH = '/api/v1';

/** Screenshots, traces, downloads and the HTML report: outside the repository. */
export const ARTIFACTS_DIR = path.resolve(
  process.env['E2E_ARTIFACTS_DIR'] ?? 'D:/meesho_saas_cache/e2e-artifacts',
);
export const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
export const DOWNLOADS_DIR = path.join(ARTIFACTS_DIR, 'downloads');
export const AXE_DIR = path.join(ARTIFACTS_DIR, 'axe');

/** api/ (the suite starts `api/dist/main.js` and reads the test database settings from there). */
export const API_ROOT = path.resolve(__dirname, '..', '..', '..', 'api');

/**
 * Every user this suite creates has an email starting with this prefix (and ending in
 * EMAIL_DOMAIN); the global setup / teardown delete those users and everything they own. No other
 * suite uses it (the API's e2e suites use `<label>-<runId>@example.test`).
 */
export const EMAIL_PREFIX = 'e2e-';
export const EMAIL_DOMAIN = '@example.test';
/** A test-only password (12–128 characters) for the throwaway users above. */
export const PASSWORD = 'correct horse battery e2e';

let sequence = 0;
/** A fresh e2e email, unique across workers and runs. */
export function newEmail(label: string): string {
  sequence += 1;
  const run = `${Date.now().toString(36)}${process.pid.toString(36)}${sequence}`;
  return `${EMAIL_PREFIX}${run}-${label}${EMAIL_DOMAIN}`;
}
