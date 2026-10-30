import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { ApiException } from '../common/errors/api.exception';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import { AppConfigService } from '../config/app-config.service';

/** Multipart field that carries the uploaded file. */
export const UPLOAD_FILE_FIELD = 'file';

const MULTER_REASONS: Record<string, string> = {
  LIMIT_FILE_COUNT: 'Send exactly one file',
  LIMIT_UNEXPECTED_FILE: `Send exactly one file, in the "${UPLOAD_FILE_FIELD}" field`,
  LIMIT_FIELD_COUNT: 'Too many form fields',
  LIMIT_FIELD_KEY: 'Form field name too long',
  LIMIT_FIELD_VALUE: 'Form field value too long',
  LIMIT_PART_COUNT: 'Too many form parts',
};

/**
 * Parses the multipart upload of POST /accounts/:accountId/imports into memory (the raw file is never
 * written to disk or stored): one file in `file`, at most IMPORT_MAX_FILE_MB (→ 413), a few short text
 * fields. Runs after the global guards, so CSRF and the session are checked before any byte is read.
 */
@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  private readonly upload: RequestHandler;
  private readonly maxFileMb: number;

  constructor(config: AppConfigService) {
    this.maxFileMb = config.importMaxFileMb;
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: config.importMaxFileBytes,
        files: 1,
        fields: 4,
        fieldSize: 1024,
        fieldNameSize: 64,
        parts: 6,
        headerPairs: 50,
      },
      // Browsers send UTF-8 file names; multer's default would read them as latin1.
      defParamCharset: 'utf8',
    }).single(UPLOAD_FILE_FIELD);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) => {
      this.upload(
        http.getRequest<Request>(),
        http.getResponse<Response>(),
        (err?: unknown) => (err ? reject(this.toHttpError(err)) : resolve()),
      );
    });
    return next.handle();
  }

  private toHttpError(err: unknown): Error {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return new ApiException(
          'PAYLOAD_TOO_LARGE',
          `The file is larger than the ${this.maxFileMb} MB limit.`,
        );
      }
      return new RequestValidationException([
        {
          field: err.field ?? UPLOAD_FILE_FIELD,
          reasons: [MULTER_REASONS[err.code] ?? 'Invalid upload'],
        },
      ]);
    }
    // busboy: malformed multipart bodies (missing boundary, truncated form, bad part headers).
    if (
      err instanceof Error &&
      /multipart|boundary|part header|end of form|end of file/i.test(
        err.message,
      )
    ) {
      return new RequestValidationException([
        {
          field: UPLOAD_FILE_FIELD,
          reasons: ['Malformed multipart/form-data request'],
        },
      ]);
    }
    return err instanceof Error ? err : new Error('Upload failed');
  }
}
