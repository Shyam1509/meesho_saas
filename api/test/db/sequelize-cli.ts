import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** api/ root (this file lives at test/db). */
export const API_ROOT = resolve(__dirname, '..', '..');

/** DB tests touch only the test database: refuse to run outside NODE_ENV=test. */
export function assertTestEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('DB tests must run with NODE_ENV=test (npm run test:db)');
  }
}

/**
 * Runs sequelize-cli (the same binary and config as the db:test:* npm scripts) in a child process
 * with NODE_ENV=test. db/config.js refuses any DB_NAME that does not end in "_test".
 * Returns stdout; a failing command throws with the CLI's stderr.
 */
export function runSequelizeCli(...args: string[]): string {
  assertTestEnvironment();
  const cli = require.resolve('sequelize-cli/lib/sequelize');
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: API_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
