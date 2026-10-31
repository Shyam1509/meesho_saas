import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, type TransformFnParams } from 'class-transformer';
import {
  buildMessage,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateBy,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { MAX_PAGE, MAX_PAGE_SIZE } from './pagination.dto';

/** Default page size of the Milestone 5 domain lists (orders, settlements, reconciliation). */
export const LIST_DEFAULT_PAGE_SIZE = 25;
/** At most this many values of a repeatable filter (`status`, `entryType`). */
export const MAX_FILTER_VALUES = 50;
/** Longest accepted search text (`q`), after trimming. */
export const MAX_SEARCH_LENGTH = 100;

/**
 * `?page=&pageSize=` of the domain lists: page >= 1, pageSize 1–100, default 25. Unknown query parameters
 * are rejected by the global ValidationPipe (whitelist + forbidNonWhitelisted).
 */
export class ListPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: LIST_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = LIST_DEFAULT_PAGE_SIZE;
}

/** SQL LIMIT/OFFSET of a validated page. */
export function listWindow(query: ListPageQueryDto): {
  limit: number;
  offset: number;
} {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}

/** Every allowed `sort` value for these keys: `key` (ascending) and `-key` (descending). */
export function sortValues<K extends string>(
  keys: readonly K[],
): (K | `-${K}`)[] {
  return keys.flatMap((key) => [key, `-${key}` as const]);
}

/** A validated `sort` value split into its key and direction. */
export function parseSort<K extends string>(
  sort: K | `-${K}`,
): { key: K; descending: boolean } {
  return sort.startsWith('-')
    ? { key: sort.slice(1) as K, descending: true }
    : { key: sort as K, descending: false };
}

/**
 * @Transform for a repeatable query parameter: `?status=A` arrives as a string, `?status=A&status=B` as an
 * array (Express "simple" query parser); both become an array. Absent stays absent.
 */
export function toArray({ value }: TransformFnParams): unknown {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/** @Transform for `q`: trimmed; blank → absent (no search). Non-strings pass through to be rejected. */
export function toSearchText({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** @Transform for a boolean query flag: only the strings 'true' / 'false' (anything else is rejected). */
export function toBooleanFlag({ value }: TransformFnParams): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date `YYYY-MM-DD` within MySQL's DATE range (years 1000–9999). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function IsCalendarDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCalendarDate',
      validator: {
        validate: (value: unknown) => isCalendarDate(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a real date in the form YYYY-MM-DD`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

/**
 * The date is not before the date in `property` (both YYYY-MM-DD; compared as text, which orders such
 * dates correctly). Passes when either side is missing or invalid: those have their own errors.
 */
export function IsNotBefore(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotBefore',
      constraints: [property],
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const other = (args?.object as Record<string, unknown> | undefined)?.[
            property
          ];
          if (!isCalendarDate(value) || !isCalendarDate(other)) return true;
          return value >= other;
        },
        defaultMessage: buildMessage(
          (each, args) =>
            `${each}$property must not be before ${String(args?.constraints[0])}`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
