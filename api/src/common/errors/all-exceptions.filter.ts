import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { sanitizeError } from '../logging/error-sanitizer';
import { ApiException } from './api.exception';
import { getRequestId, REQUEST_ID_HEADER } from '../logging/request-id';
import {
  ERROR_CODE_STATUS,
  errorCodeForStatus,
  GENERIC_SERVER_ERROR_MESSAGE,
} from './error-codes';
import type { ErrorResponseDto } from './error-response.dto';
import { FieldConflictException } from './field-conflict.exception';
import { RequestValidationException } from './request-validation.exception';

export interface ErrorEnvelope {
  status: number;
  body: ErrorResponseDto;
}

/** Errors raised by Express middleware such as body-parser (http-errors objects). */
interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
}

const CLIENT_MESSAGES: Record<number, string> = {
  400: 'Malformed request',
  413: 'Request payload too large',
};

function messageFromHttpException(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = response.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  }
  return exception.message;
}

function clientErrorStatus(exception: unknown): number | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const { status, statusCode, expose } = exception as HttpErrorLike;
  const value = typeof status === 'number' ? status : statusCode;
  if (
    expose === true &&
    typeof value === 'number' &&
    value >= 400 &&
    value < 500
  ) {
    return value;
  }
  return undefined;
}

/** Pure mapping from any thrown value to the `{ error: {...} }` envelope (5xx never leak details). */
export function toErrorEnvelope(
  exception: unknown,
  requestId: string,
): ErrorEnvelope {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code =
      exception instanceof ApiException && status < 500
        ? exception.code
        : errorCodeForStatus(status);
    if (status >= 500) {
      return {
        status,
        body: {
          error: { code, message: GENERIC_SERVER_ERROR_MESSAGE, requestId },
        },
      };
    }
    const body: ErrorResponseDto = {
      error: { code, message: messageFromHttpException(exception), requestId },
    };
    if (
      exception instanceof RequestValidationException ||
      exception instanceof FieldConflictException
    ) {
      body.error.details = exception.details;
    } else if (exception instanceof ApiException && exception.details) {
      body.error.details = exception.details;
    }
    return { status, body };
  }

  const clientStatus = clientErrorStatus(exception);
  if (clientStatus !== undefined) {
    return {
      status: clientStatus,
      body: {
        error: {
          code: errorCodeForStatus(clientStatus),
          message: CLIENT_MESSAGES[clientStatus] ?? 'Bad request',
          requestId,
        },
      },
    };
  }

  return {
    status: ERROR_CODE_STATUS.INTERNAL_ERROR,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_SERVER_ERROR_MESSAGE,
        requestId,
      },
    },
  };
}

/** Global filter: every error leaves the API in the same envelope; stacks stay in the server log. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request);
    const { status, body } = toErrorEnvelope(exception, requestId);

    if (status >= 500) {
      // Sanitised here as well as by the pino `err` serializer, so no logger setup can leak SQL/values.
      this.logger.error(
        {
          err: sanitizeError(exception),
          requestId,
          method: request.method,
          path: request.path,
        },
        'Unhandled error',
      );
    }

    if (response.headersSent) {
      // Part of a response is already on the wire: abort it so the client sees a broken
      // stream instead of a truncated body that looks complete.
      response.destroy();
      return;
    }
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(status).json(body);
  }
}
