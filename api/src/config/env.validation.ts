import 'reflect-metadata'; // class-transformer's @Type needs it even outside Nest (e.g. unit tests).
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
  ValidationError,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** scheme://host[:port], no path or trailing slash (that is what browsers send as Origin). */
const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

function toOriginList(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** 'true' / 'false' (any case) become booleans; anything else is left for @IsBoolean to reject. */
function toBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return value;
}

/**
 * The only environment variables the API reads. Validated once at startup;
 * everything else goes through AppConfigService.
 * Required fields use `!`: plainToInstance assigns them and validateSync rejects the
 * instance if any is missing, so no unvalidated instance ever leaves validateEnv.
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV!: NodeEnv;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3100;

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @Transform(({ value }) => toOriginList(value))
  @ArrayNotEmpty()
  @Matches(ORIGIN_PATTERN, { each: true })
  CORS_ORIGINS: string[] = ['http://localhost:4310'];

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  /** Whether POST /auth/register is open. Off unless explicitly enabled. */
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  AUTH_REGISTRATION_ENABLED: boolean = false;

  /**
   * Secure flag (and the __Host- prefix) on auth cookies. Unset = NODE_ENV === 'production', resolved in
   * validateEnv; false is rejected in production.
   */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  COOKIE_SECURE?: boolean;

  /** Session idle timeout: minutes without a request before the session ends. */
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(43_200)
  SESSION_IDLE_MINUTES: number = 720;

  /** Absolute session lifetime in hours, however active the session is. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8_760)
  SESSION_ABSOLUTE_HOURS: number = 168;

  /** Requests per minute per client IP to each of POST /auth/login and POST /auth/register. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  AUTH_RATE_LIMIT_PER_MINUTE: number = 10;

  /** Largest import upload accepted, in MB (1 MB = 1,048,576 bytes); larger files get 413. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  IMPORT_MAX_FILE_MB: number = 10;

  /** Most non-blank data rows one import file may contain (all sheets together); more gets 422. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200_000)
  IMPORT_MAX_ROWS: number = 50_000;

  /** Most rows one CSV export may contain (M7); more gets 422 "narrow the filters". Can only be lowered. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  REPORT_MAX_ROWS: number = 100_000;
}

const KNOWN_KEYS: ReadonlyArray<keyof EnvironmentVariables> = [
  'NODE_ENV',
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'CORS_ORIGINS',
  'LOG_LEVEL',
  'AUTH_REGISTRATION_ENABLED',
  'COOKIE_SECURE',
  'SESSION_IDLE_MINUTES',
  'SESSION_ABSOLUTE_HOURS',
  'AUTH_RATE_LIMIT_PER_MINUTE',
  'IMPORT_MAX_FILE_MB',
  'IMPORT_MAX_ROWS',
  'REPORT_MAX_ROWS',
];

/** Test runs may only touch databases whose name ends in this suffix. */
export const TEST_DB_SUFFIX = '_test';

/** Thrown when the environment is invalid. The message names variables only, never their values. */
export class EnvValidationError extends Error {
  constructor(
    readonly variables: string[],
    hints: string[] = [],
  ) {
    super(
      [
        `Invalid environment configuration. Missing or invalid variable(s): ${variables.join(', ')}`,
        ...hints,
      ].join('. '),
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates raw environment values (strings) and returns the typed configuration.
 * Unknown keys are ignored; an empty string is treated as "not set" so defaults apply
 * and required variables fail. Used as the `validate` hook of ConfigModule.forRoot.
 */
export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const known: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    known[key] = typeof value === 'string' ? value.trim() : value;
  }

  const config = plainToInstance(EnvironmentVariables, known);
  const errors = validateSync(config, { skipMissingProperties: false });
  // Only property names leave this function; ValidationError.value is deliberately dropped.
  const names = new Set(errors.map((error: ValidationError) => error.property));
  const hints: string[] = [];

  // Guard: tests must never run against a dev/prod database.
  if (
    config.NODE_ENV === 'test' &&
    !names.has('DB_NAME') &&
    !config.DB_NAME.endsWith(TEST_DB_SUFFIX)
  ) {
    names.add('DB_NAME');
    hints.push(`NODE_ENV=test requires DB_NAME to end in "${TEST_DB_SUFFIX}"`);
  }

  // Auth cookies must carry the Secure flag in production.
  if (!names.has('COOKIE_SECURE') && !names.has('NODE_ENV')) {
    if (config.COOKIE_SECURE === undefined) {
      config.COOKIE_SECURE = config.NODE_ENV === 'production';
    } else if (config.NODE_ENV === 'production' && !config.COOKIE_SECURE) {
      names.add('COOKIE_SECURE');
      hints.push('COOKIE_SECURE=false is not allowed with NODE_ENV=production');
    }
  }

  // An idle timeout longer than the absolute lifetime can never apply.
  if (
    !names.has('SESSION_IDLE_MINUTES') &&
    !names.has('SESSION_ABSOLUTE_HOURS') &&
    config.SESSION_IDLE_MINUTES > config.SESSION_ABSOLUTE_HOURS * 60
  ) {
    names.add('SESSION_IDLE_MINUTES');
    hints.push(
      'SESSION_IDLE_MINUTES must not exceed SESSION_ABSOLUTE_HOURS * 60',
    );
  }

  if (names.size > 0) {
    throw new EnvValidationError([...names], hints);
  }
  return config;
}
