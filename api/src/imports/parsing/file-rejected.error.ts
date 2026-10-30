import type { ValidationErrorDetailDto } from '../../common/errors/error-response.dto';

/**
 * A problem with the file as a whole (type, encoding, structure, headers, limits). Raised by the pure
 * parsing code; the service turns it into a 422 PARSE_ERROR and creates no import job. Reasons are
 * written for the person who uploaded the file and never contain cell values.
 */
export class FileRejectedError extends Error {
  constructor(readonly details: ValidationErrorDetailDto[]) {
    super('The file cannot be imported.');
    this.name = 'FileRejectedError';
  }

  static of(field: string, ...reasons: string[]): FileRejectedError {
    return new FileRejectedError([{ field, reasons }]);
  }
}
