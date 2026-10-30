import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, TimeoutError, catchError, map, of, throwError, timeout } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { HealthCheckResult, HealthResponse, isHealthResponse } from './health.models';

/** How long a health check may take before the API counts as unreachable. */
export const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Raised by {@link HealthApiService.getHealth} when the API gave no usable health answer. */
export class ApiUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}

@Injectable({ providedIn: 'root' })
export class HealthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * `GET {API_BASE_URL}/health`.
   * Emits the body for a 200, and for a 503 whose body has the health shape (API up, database
   * down). Anything else errors with {@link ApiUnreachableError}.
   */
  getHealth(): Observable<HealthResponse> {
    return this.http.get<unknown>(`${this.baseUrl}/health`).pipe(
      timeout(HEALTH_CHECK_TIMEOUT_MS),
      map((body) => {
        if (!isHealthResponse(body)) {
          throw new ApiUnreachableError('The API answered, but not with a health response.');
        }
        return body;
      }),
      catchError((error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 503 &&
          isHealthResponse(error.error)
        ) {
          return of(error.error);
        }
        return throwError(() => toUnreachableError(error));
      }),
    );
  }

  /** Same request as {@link getHealth}, classified for the UI. Never errors. */
  checkHealth(): Observable<HealthCheckResult> {
    return this.getHealth().pipe(
      map((health): HealthCheckResult =>
        health.status === 'ok' && health.db === 'up'
          ? { kind: 'ok', health }
          : { kind: 'degraded', health },
      ),
      catchError((error: unknown) =>
        of<HealthCheckResult>({ kind: 'unreachable', reason: toUnreachableError(error).message }),
      ),
    );
  }
}

function toUnreachableError(error: unknown): ApiUnreachableError {
  if (error instanceof ApiUnreachableError) {
    return error;
  }
  if (error instanceof TimeoutError) {
    return new ApiUnreachableError(
      `The API did not answer within ${HEALTH_CHECK_TIMEOUT_MS / 1000} seconds.`,
    );
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiUnreachableError('No response from the API (network error).');
    }
    const requestId = readRequestId(error.error);
    return new ApiUnreachableError(
      `The health check failed with HTTP ${error.status}` +
        (requestId ? ` (request ID ${requestId}).` : '.'),
    );
  }
  return new ApiUnreachableError('The health check failed unexpectedly.');
}

/** Reads `error.requestId` from the API's `{ error: { code, message, requestId } }` envelope. */
function readRequestId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const envelope = (body as Record<string, unknown>)['error'];
  if (typeof envelope !== 'object' || envelope === null) {
    return null;
  }
  const requestId = (envelope as Record<string, unknown>)['requestId'];
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : null;
}
