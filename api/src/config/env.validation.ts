import 'reflect-metadata'; // class-transformer's @Type needs it even outside Nest (e.g. unit tests).
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsNotEmpty,
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
  CORS_ORIGINS: string[] = ['http://localhost:4300'];

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';
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

  if (names.size > 0) {
    throw new EnvValidationError([...names], hints);
  }
  return config;
}
