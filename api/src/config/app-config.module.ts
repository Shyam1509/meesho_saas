import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.validation';

/** api/ root; this file lives at src/config (ts-jest) or dist/config (build), both two levels down. */
const API_ROOT = resolve(__dirname, '..', '..');

/** `.env.test` when NODE_ENV=test, otherwise `.env`. Production reads no file at all. */
export function resolveEnvFilePath(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  return resolve(API_ROOT, nodeEnv === 'test' ? '.env.test' : '.env');
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolveEnvFilePath(),
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
