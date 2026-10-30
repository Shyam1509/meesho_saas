import { HttpStatus } from '@nestjs/common';

/**
 * Single source of truth for API error codes and their HTTP status.
 * Modules throw Nest HttpExceptions and the global filter maps their status here, or an ApiException
 * (api.exception.ts) when the code is not implied by the status (e.g. PARSE_ERROR).
 */
export const ERROR_CODE_STATUS = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  /** An uploaded file the importer cannot read or accept (wrong type, encoding, headers, limits). */
  PARSE_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  /** Any other 4xx not listed above (e.g. 405, 406, 415, a plain 422). */
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
} as const satisfies Record<string, HttpStatus>;

export type ErrorCode = keyof typeof ERROR_CODE_STATUS;

const STATUS_TO_CODE: ReadonlyMap<number, ErrorCode> = new Map<
  number,
  ErrorCode
>([
  [HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR'],
  [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
  [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  [HttpStatus.CONFLICT, 'CONFLICT'],
  [HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE'],
  [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED'],
]);

/** Maps an HTTP status to its error code; unlisted 4xx → BAD_REQUEST, everything else → INTERNAL_ERROR. */
export function errorCodeForStatus(status: number): ErrorCode {
  const code = STATUS_TO_CODE.get(status);
  if (code) return code;
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL_ERROR';
}

/** Message used for every 5xx response; real details stay in the server log. */
export const GENERIC_SERVER_ERROR_MESSAGE =
  'An unexpected error occurred. Please try again later.';
