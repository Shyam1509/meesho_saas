import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { ValidationErrorDetailDto } from './error-response.dto';

/** BadRequest raised by the global ValidationPipe, carrying per-field reasons. */
export class RequestValidationException extends BadRequestException {
  constructor(readonly details: ValidationErrorDetailDto[]) {
    super('Request validation failed');
  }
}

/** Flattens class-validator's nested error tree into `{ field: 'a.b.0.c', reasons }` entries. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetailDto[] {
  const details: ValidationErrorDetailDto[] = [];
  for (const error of errors) {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    if (error.constraints) {
      details.push({ field, reasons: Object.values(error.constraints) });
    }
    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }
  return details;
}

/** exceptionFactory for ValidationPipe: never echoes the rejected values back. */
export function validationExceptionFactory(
  errors: ValidationError[],
): RequestValidationException {
  return new RequestValidationException(flattenValidationErrors(errors));
}
