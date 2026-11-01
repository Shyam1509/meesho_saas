import { HttpErrorResponse } from '@angular/common/http';

import { errorBody } from '../../../testing/test-data';
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  describeApiError,
  errorReference,
  toApiError,
} from './api-error';

describe('toApiError', () => {
  it('maps an error envelope with field details', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 409,
        error: errorBody('CONFLICT', 'Already in use.', [
          { field: 'displayName', reasons: ['is already used in this workspace'] },
          { field: 'bogus', reasons: [42] } as never,
        ]),
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Already in use.');
    expect(error.requestId).toBe('req-1');
    expect(error.details).toEqual([
      { field: 'displayName', reasons: ['is already used in this workspace'] },
    ]);
    expect(error.reasonsFor('displayName')).toEqual(['is already used in this workspace']);
    expect(error.reasonsFor('meeshoSupplierId')).toEqual([]);
  });

  it('maps a network error (status 0)', () => {
    const error = toApiError(
      new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }),
    );
    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.message).toBe("Can't reach the server. Check your connection and try again.");
  });

  it('maps a response that is not an envelope', () => {
    const error = toApiError(
      new HttpErrorResponse({ status: 500, error: '<html>Internal error</html>' }),
    );
    expect(error.status).toBe(500);
    expect(error.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.message).toBe('The server returned an unexpected response (HTTP 500).');
    expect(error.details).toEqual([]);
  });

  it.each([502, 503, 504])(
    'maps a %s without the envelope (a proxy in front of a down API) to the unreachable message',
    (status) => {
      const error = toApiError(new HttpErrorResponse({ status, error: '<html>Bad gateway</html>' }));
      expect(error.status).toBe(status);
      expect(error.code).toBe('SERVER_UNREACHABLE');
      expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
      expect(describeApiError(error)).toBe(
        "Can't reach the server. Check your connection and try again.",
      );
    },
  );

  it('keeps the own 503 message and reference of the API when it sent the envelope', () => {
    const error = new HttpErrorResponse({
      status: 503,
      error: errorBody('SERVICE_UNAVAILABLE', 'The database is not reachable.'),
    });
    expect(toApiError(error).code).toBe('SERVICE_UNAVAILABLE');
    expect(describeApiError(error)).toBe('The database is not reachable. (Reference: req-1)');
  });

  it('passes an ApiError through and wraps anything else', () => {
    const apiError = new ApiError(403, 'FORBIDDEN', 'No.');
    expect(toApiError(apiError)).toBe(apiError);
    expect(toApiError(new Error('boom')).message).toBe('Something went wrong. Try again.');
  });
});

describe('describeApiError', () => {
  it('adds the request ID as the support reference for server errors only', () => {
    const serverError = new HttpErrorResponse({
      status: 500,
      error: errorBody('INTERNAL_ERROR', 'An unexpected error occurred. Please try again later.'),
    });
    expect(describeApiError(serverError)).toBe(
      'An unexpected error occurred. Please try again later. (Reference: req-1)',
    );

    const clientError = new HttpErrorResponse({
      status: 401,
      error: errorBody('UNAUTHORIZED', 'Invalid email or password.'),
    });
    expect(describeApiError(clientError)).toBe('Invalid email or password.');
  });
});

describe('errorReference', () => {
  it('is the request ID of a server error', () => {
    const error = new HttpErrorResponse({ status: 503, error: errorBody('UNAVAILABLE', 'Down.') });
    expect(errorReference(error)).toBe('req-1');
  });

  it('is null for client and network errors, and for a server error without an ID', () => {
    expect(
      errorReference(new HttpErrorResponse({ status: 404, error: errorBody('NOT_FOUND', 'No.') })),
    ).toBeNull();
    expect(
      errorReference(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })),
    ).toBeNull();
    expect(errorReference(new HttpErrorResponse({ status: 502, error: 'Bad gateway' }))).toBeNull();
  });

  it('describes a network error as the server being unreachable, without a reference', () => {
    expect(
      describeApiError(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })),
    ).toBe("Can't reach the server. Check your connection and try again.");
  });
});
