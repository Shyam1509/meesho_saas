import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  // abortOnError: false so startup failures (e.g. invalid env) reach the catch below.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  configureApp(app);
  await app.listen(app.get(AppConfigService).port);
}

bootstrap().catch((err: unknown) => {
  // The logger may not be attached yet, so report on stderr. Messages never contain secrets.
  console.error(
    `API failed to start: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
