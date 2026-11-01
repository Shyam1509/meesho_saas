import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, LogLevel, NodeEnv } from './env.validation';

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

/** Typed, read-only access to the validated configuration. Services use this, never process.env. */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  get nodeEnv(): NodeEnv {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get database(): DatabaseConfig {
    return {
      host: this.config.get('DB_HOST', { infer: true }),
      port: this.config.get('DB_PORT', { infer: true }),
      name: this.config.get('DB_NAME', { infer: true }),
      user: this.config.get('DB_USER', { infer: true }),
      password: this.config.get('DB_PASSWORD', { infer: true }),
    };
  }

  get corsOrigins(): string[] {
    return this.config.get('CORS_ORIGINS', { infer: true });
  }

  get authRegistrationEnabled(): boolean {
    return this.config.get('AUTH_REGISTRATION_ENABLED', { infer: true });
  }

  /** Secure flag for auth cookies; validateEnv has already resolved the NODE_ENV default. */
  get cookieSecure(): boolean {
    return (
      this.config.get('COOKIE_SECURE', { infer: true }) ?? this.isProduction
    );
  }

  get sessionIdleMinutes(): number {
    return this.config.get('SESSION_IDLE_MINUTES', { infer: true });
  }

  get sessionAbsoluteHours(): number {
    return this.config.get('SESSION_ABSOLUTE_HOURS', { infer: true });
  }

  get authRateLimitPerMinute(): number {
    return this.config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true });
  }

  /** Upload size limit for imports, in MB. */
  get importMaxFileMb(): number {
    return this.config.get('IMPORT_MAX_FILE_MB', { infer: true });
  }

  /** Upload size limit for imports, in bytes (MB × 1,048,576). */
  get importMaxFileBytes(): number {
    return this.importMaxFileMb * 1024 * 1024;
  }

  /** Most non-blank data rows per import file. */
  get importMaxRows(): number {
    return this.config.get('IMPORT_MAX_ROWS', { infer: true });
  }

  /** Most rows per CSV export (M7); a larger export is refused with 422 before any row is sent. */
  get reportMaxRows(): number {
    return this.config.get('REPORT_MAX_ROWS', { infer: true });
  }

  /**
   * CSV exports streaming at the same time in this process (M7; fixed, not an env variable: each holds one
   * pooled connection of 5). More → 429. Tests pin it through the e2e config overrides.
   */
  get reportMaxConcurrentExports(): number {
    return 2;
  }

  /** A CSV export whose client accepts no data for this long is cut off (M7; fixed, tests pin it). */
  get reportStallTimeoutMs(): number {
    return 60_000;
  }

  /** Effective logger level: always silent under test. */
  get logLevel(): LogLevel {
    return this.isTest
      ? 'silent'
      : this.config.get('LOG_LEVEL', { infer: true });
  }
}
