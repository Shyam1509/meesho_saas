import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppConfigService } from '../../src/config/app-config.service';
import type { EnvironmentVariables } from '../../src/config/env.validation';

/** Header the e2e app turns into req.ip (see createE2eApp). */
export const TEST_CLIENT_IP_HEADER = 'x-test-client-ip';

/** Config values a suite may pin regardless of what .env.test says. */
export interface ConfigOverrides {
  authRegistrationEnabled?: boolean;
  authRateLimitPerMinute?: number;
}

export interface E2eApp {
  app: NestExpressApplication;
  server: Server;
  /** The app's own connection to meesho_test, for arranging and asserting rows. */
  sequelize: Sequelize;
  config: AppConfigService;
}

/**
 * Real AppModule + configureApp against meesho_test (NODE_ENV=test → .env.test). By default
 * registration is on and the per-IP auth limit is high, so suites do not depend on local .env.test
 * values and only the limits suite meets the throttler. One app per spec file: the models bind to
 * the latest connection.
 */
export async function createE2eApp(
  overrides: ConfigOverrides = {},
): Promise<E2eApp> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'e2e tests must run with NODE_ENV=test (use npm run test:e2e)',
    );
  }
  const pinned: ConfigOverrides = {
    authRegistrationEnabled: true,
    authRateLimitPerMinute: 1000,
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfigService)
    .useFactory({
      factory: (config: ConfigService<EnvironmentVariables, true>) => {
        const service = new AppConfigService(config);
        // Own data properties shadow the prototype getters.
        for (const [key, value] of Object.entries(pinned)) {
          Object.defineProperty(service, key, { value });
        }
        return service;
      },
      inject: [ConfigService],
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  // Test-only seam, registered before everything else: every request comes from 127.0.0.1, so a
  // request may claim another client IP with this header (shadows Express's req.ip getter, which the
  // throttler and the failed-login limiter read). Never part of the real app.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const ip = req.headers[TEST_CLIENT_IP_HEADER];
    if (typeof ip === 'string') {
      Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    }
    next();
  });
  configureApp(app);
  await app.init();
  return {
    app,
    server: app.getHttpServer(),
    sequelize: app.get<Sequelize>(getConnectionToken()),
    config: app.get(AppConfigService),
  };
}

/** A suffix that makes this run's emails unique, so suites never collide with each other or old rows. */
export function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

/**
 * Deletes everything created by users whose email ends in `-<runId>@example.test`, children first
 * (audit_logs and seller_accounts are RESTRICT; memberships and sessions cascade).
 */
export async function deleteRunData(
  sequelize: Sequelize,
  runId: string,
): Promise<void> {
  const pattern = `%-${runId}@example.test`;
  const run = (sql: string) =>
    sequelize.query(sql, {
      replacements: { pattern },
      type: QueryTypes.DELETE,
    });
  const runWorkspaces = `SELECT w.id FROM workspaces w JOIN users u ON u.id = w.created_by_user_id
                         WHERE u.email LIKE :pattern`;
  await run(
    `DELETE FROM audit_logs
     WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE :pattern)
        OR workspace_id IN (${runWorkspaces})`,
  );
  await run(
    `DELETE FROM seller_accounts WHERE workspace_id IN (${runWorkspaces})`,
  );
  await run(
    `DELETE FROM workspaces WHERE created_by_user_id IN
       (SELECT id FROM users WHERE email LIKE :pattern)`,
  );
  await run(`DELETE FROM users WHERE email LIKE :pattern`);
}
