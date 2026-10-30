import { HttpException } from '@nestjs/common';
import { ERROR_CODE_STATUS, type ErrorCode } from './error-codes';
import type { ValidationErrorDetailDto } from './error-response.dto';

/**
 * An HttpException that names its error code explicitly (the status follows from the code via
 * ERROR_CODE_STATUS, so the two can never disagree). Use it when the code is not implied by the status,
 * e.g. PARSE_ERROR (422), or when a 4xx needs `details`. `details` must never echo rejected values or
 * file contents. 5xx codes still get the generic message from the global filter.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ValidationErrorDetailDto[],
  ) {
    super(message, ERROR_CODE_STATUS[code]);
  }
}
