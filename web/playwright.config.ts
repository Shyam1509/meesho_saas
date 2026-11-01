import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { API_PORT, API_ROOT, ARTIFACTS_DIR, BASE_URL, WEB_PORT } from './e2e/support/env';

/**
 * End-to-end + accessibility tests (Milestone 8): a real browser against the real API and the test
 * database. `npm run e2e` starts its own stack and stops it afterwards:
 * - the API from `api/dist/main.js` (build it with `npm run build` in api/ first) with
 *   NODE_ENV=test, so it uses api/.env.test → meesho_test, on port 3101;
 * - `ng serve` on port 4311, proxying /api to 3101 (proxy.e2e.json), without file watching, so
 *   edits made during a run do not reload the pages under test.
 * The global teardown deletes every user the suite created (`e2e-…@example.test`) and their data.
 * Never run it while the API's own `test:db` / `test:e2e` suites run: they share meesho_test.
 *
 * Browsers are NOT downloaded: the installed Chrome is used (`channel: 'chrome'`), or Microsoft Edge
 * when Chrome is missing; override with E2E_CHANNEL=chrome|msedge.
 */

/** Fails early when api/dist is older than the API sources (excluding specs). */
function assertApiBuildFresh(): void {
  const main = path.join(API_ROOT, 'dist', 'main.js');
  if (!existsSync(main)) {
    throw new Error('api/dist/main.js is missing: run `npm run build` in api/ first.');
  }
  const built = statSync(main).mtimeMs;
  const newer: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        if (statSync(full).mtimeMs > built) newer.push(path.relative(API_ROOT, full));
      }
    }
  };
  walk(path.join(API_ROOT, 'src'));
  if (newer.length > 0) {
    throw new Error(
      `api/dist is older than ${newer.slice(0, 3).join(', ')}${newer.length > 3 ? ', …' : ''}: ` +
        'run `npm run build` in api/ first.',
    );
  }
}
// Once, in the runner process: workers re-load this config and need not walk api/src again.
if (!process.env['TEST_WORKER_INDEX']) {
  assertApiBuildFresh();
}

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env['LOCALAPPDATA'] ?? ''}/Google/Chrome/Application/chrome.exe`,
];
const channel =
  process.env['E2E_CHANNEL'] ?? (CHROME_PATHS.some((p) => existsSync(p)) ? 'chrome' : 'msedge');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: path.join(ARTIFACTS_DIR, 'test-results'),
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env['E2E_WORKERS'] ? Number(process.env['E2E_WORKERS']) : 2,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACTS_DIR, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(ARTIFACTS_DIR, 'results.json') }],
  ],
  use: {
    baseURL: BASE_URL,
    channel,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 800 } },
    },
    {
      // The smoke flow (tests tagged @smoke) on a phone-sized screen.
      name: 'mobile-390',
      grep: /@smoke/,
      use: {
        channel,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node dist/main.js',
      cwd: API_ROOT,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        CORS_ORIGINS: BASE_URL,
        AUTH_REGISTRATION_ENABLED: 'true',
        // Every test registers its own users from 127.0.0.1 (the API suites pin the same value).
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'web',
      command: `npx ng serve --port ${WEB_PORT} --proxy-config proxy.e2e.json --watch=false --live-reload=false --hmr=false`,
      cwd: __dirname,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
