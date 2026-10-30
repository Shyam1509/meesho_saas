import {
  Injectable,
  PipeTransform,
  type ArgumentMetadata,
} from '@nestjs/common';
import { RequestValidationException } from '../errors/request-validation.exception';

/** Positive decimal id without leading zeros, at most 16 digits (fits BIGINT UNSIGNED). */
export const ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/**
 * Validates a path id (`:workspaceId`, `:accountId`, ...) and keeps it as a string: ids are BIGINT and
 * may exceed Number.MAX_SAFE_INTEGER, so they never pass through a JS number. Invalid → 400 with the
 * parameter name in `details` (the rejected value is not echoed).
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && ID_PATTERN.test(value)) return value;
    throw new RequestValidationException([
      {
        field: metadata.data ?? 'id',
        reasons: ['must be a positive integer id'],
      },
    ]);
  }
}
