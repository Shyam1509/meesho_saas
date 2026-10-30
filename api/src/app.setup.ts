import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import {
  authCookieSettings,
  sessionCookieName,
  XSRF_COOKIE,
} from './auth/auth-cookies';
import { createCsrfSeedMiddleware } from './auth/csrf/csrf-seed.middleware';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { validationExceptionFactory } from './common/errors/request-validation.exception';
import { noStoreMiddleware } from './common/http/no-store.middleware';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/logging/request-id';
import { AppConfigService } from './config/app-config.service';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';
export const SWAGGER_JSON_PATH = 'api/docs-json';

/** Global request validation: unknown fields rejected, DTO transforms applied, values never echoed. */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
};

/**
 * Everything applied to the Nest app before it starts listening. Shared by main.ts and the
 * e2e tests so both exercise the same pipeline. Must run before app.init()/listen().
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // 'trust proxy' is deliberately not set: that is a deployment decision (M9).
  app.use(requestIdMiddleware);
  app.use(`/${API_PREFIX}`, noStoreMiddleware);
  // Cookies: parsed for the session/XSRF checks; any response to a request without a valid
  // msaas_xsrf cookie seeds one (enforcement is CsrfGuard, registered in AuthModule).
  const cookieSettings = authCookieSettings(config);
  app.use(cookieParser());
  app.use(createCsrfSeedMiddleware(cookieSettings));
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Meesho Seller SaaS API')
      .setDescription(
        'Multi-account dashboard API for Meesho sellers. All endpoints live under /api/v1; errors use the { error: { code, message, requestId, details? } } envelope.',
      )
      .setVersion('0.1.0')
      .addCookieAuth(
        sessionCookieName(cookieSettings),
        {
          type: 'apiKey',
          in: 'cookie',
          description:
            'Opaque session token set by POST /auth/login or /auth/register (HttpOnly).',
        },
        'session',
      )
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-XSRF-TOKEN',
          description: `Required on POST/PUT/PATCH/DELETE: the value of the ${XSRF_COOKIE} cookie.`,
        },
        'xsrf',
      )
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
  });
}
