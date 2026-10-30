import { ConflictException } from '@nestjs/common';
import type { ValidationErrorDetailDto } from './error-response.dto';

/**
 * 409 for a value that collides with an existing row (e.g. a duplicate name), naming the field(s) in
 * `details` like a validation error. The rejected values themselves are never echoed back.
 */
export class FieldConflictException extends ConflictException {
  constructor(
    message: string,
    readonly details: ValidationErrorDetailDto[],
  ) {
    super(message);
  }
}
