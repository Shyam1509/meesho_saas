import { HttpErrorResponse } from '@angular/common/http';

/** One entry of the envelope's `details`: the offending field and why it was rejected. */
export interface ApiFieldError {
  field: string;
  reasons: string[];
}

export const NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * A failed API call, as the UI needs it. Built from the API's
 * `{ error: { code, message, requestId, details? } }` envelope; `status` is 0 for a network error.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly details: readonly ApiFieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The server's reasons for one field (empty when it named none). */
  reasonsFor(field: string): string[] {
    return this.details.filter((d) => d.field === field).flatMap((d) => d.reasons);
  }
}

/** Maps anything an `HttpClient` call can throw to an {@link ApiError}. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }
    const envelope = readEnvelope(error.error);
    if (envelope) {
      return new ApiError(
        error.status,
        envelope.code,
        envelope.message,
        envelope.requestId,
        envelope.details,
      );
    }
    return new ApiError(
      error.status,
      'UNEXPECTED_RESPONSE',
      `The server returned an unexpected response (HTTP ${error.status}).`,
    );
  }
  return new ApiError(0, 'UNKNOWN', 'Something went wrong. Try again.');
}

/** Text for an error banner. Server errors (5xx) carry the request ID so a report can be traced. */
export function describeApiError(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.status >= 500 && apiError.requestId
    ? `${apiError.message} (request ID ${apiError.requestId})`
    : apiError.message;
}

interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string | null;
  details: ApiFieldError[];
}

function readEnvelope(body: unknown): ErrorEnvelope | null {
  if (!isRecord(body) || !isRecord(body['error'])) {
    return null;
  }
  const { code, message, requestId, details } = body['error'];
  if (typeof code !== 'string' || typeof message !== 'string' || message.length === 0) {
    return null;
  }
  return {
    code,
    message,
    requestId: typeof requestId === 'string' && requestId.length > 0 ? requestId : null,
    details: Array.isArray(details) ? details.filter(isFieldError) : [],
  };
}

function isFieldError(value: unknown): value is ApiFieldError {
  return (
    isRecord(value) &&
    typeof value['field'] === 'string' &&
    Array.isArray(value['reasons']) &&
    value['reasons'].every((reason) => typeof reason === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
