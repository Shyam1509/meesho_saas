import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  clearXsrfCookie,
  errorBody,
  errorRow,
  fakeFile,
  importDetail,
  importRow,
  importSummary,
  paged,
  setXsrfCookie,
} from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { ImportsApiService } from './imports-api.service';

describe('ImportsApiService', () => {
  let service: ImportsApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ImportsApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
  });

  describe('upload()', () => {
    it('POSTs multipart form data with the file (no manual Content-Type) and the XSRF header', async () => {
      setXsrfCookie('token-1');
      const file = fakeFile('orders-oct.csv', 2048, 'text/csv');
      const result = firstValueFrom(service.upload('100', file));

      const req = httpTesting.expectOne('/api/v1/accounts/100/imports');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);
      const body = req.request.body as FormData;
      expect(body.get('file')).toBeInstanceOf(File);
      expect((body.get('file') as File).name).toBe('orders-oct.csv');
      expect(body.has('dataAsOf')).toBe(false);
      expect(req.request.headers.has('Content-Type')).toBe(false);
      expect(req.request.headers.get('X-XSRF-TOKEN')).toBe('token-1');

      req.flush(importDetail(), { status: 201, statusText: 'Created' });
      expect(await result).toEqual(importDetail());
    });

    it('adds the date-only dataAsOf when given', () => {
      service.upload('100', fakeFile('orders.csv'), '2026-10-29').subscribe();
      const req = httpTesting.expectOne('/api/v1/accounts/100/imports');
      const body = req.request.body as FormData;
      expect(body.get('dataAsOf')).toBe('2026-10-29');
      req.flush(importDetail());
    });

    it.each([
      [422, 'PARSE_ERROR', 'The file could not be read.'],
      [409, 'CONFLICT', 'This file was already imported.'],
      [413, 'PAYLOAD_TOO_LARGE', 'The file is too large.'],
      [429, 'RATE_LIMITED', 'Imports are busy, try again in a moment.'],
    ])('maps a %s to an ApiError with details', async (status, code, message) => {
      const result = firstValueFrom(service.upload('100', fakeFile('orders.csv')));
      httpTesting
        .expectOne('/api/v1/accounts/100/imports')
        .flush(errorBody(code, message, [{ field: 'file', reasons: ['a reason'] }]), {
          status,
          statusText: 'Error',
        });
      const error = (await result.catch((e: unknown) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(error.reasonsFor('file')).toEqual(['a reason']);
    });
  });

  it('config() GETs /imports/config', async () => {
    const result = firstValueFrom(service.config());
    const req = httpTesting.expectOne('/api/v1/imports/config');
    expect(req.request.method).toBe('GET');
    req.flush({ maxFileMb: 10, maxRows: 50000 });
    expect(await result).toEqual({ maxFileMb: 10, maxRows: 50000 });
  });

  it('list() GETs /accounts/:id/imports with page and pageSize', async () => {
    const page = paged([importSummary()], 2, 21);
    const result = firstValueFrom(service.list('100', { page: 2, pageSize: 20 }));
    const req = httpTesting.expectOne('/api/v1/accounts/100/imports?page=2&pageSize=20');
    expect(req.request.method).toBe('GET');
    req.flush(page);
    expect(await result).toEqual(page);
  });

  it('list() leaves out paging values that were not given', () => {
    service.list('100').subscribe();
    const req = httpTesting.expectOne('/api/v1/accounts/100/imports');
    expect(req.request.params.keys()).toEqual([]);
    req.flush(paged([]));
  });

  it('get() GETs /imports/:id', async () => {
    const result = firstValueFrom(service.get('500'));
    const req = httpTesting.expectOne('/api/v1/imports/500');
    expect(req.request.method).toBe('GET');
    req.flush(importDetail());
    expect(await result).toEqual(importDetail());
  });

  it('rows() GETs /imports/:id/rows with status, page and pageSize', async () => {
    const page = paged([importRow()]);
    const result = firstValueFrom(service.rows('500', { status: 'valid', page: 1, pageSize: 50 }));
    const req = httpTesting.expectOne('/api/v1/imports/500/rows?page=1&pageSize=50&status=valid');
    expect(req.request.method).toBe('GET');
    req.flush(page);
    expect(await result).toEqual(page);
  });

  it('errors() GETs /imports/:id/errors with page and pageSize', async () => {
    const page = paged([errorRow(7)], 3, 45);
    const result = firstValueFrom(service.errors('500', { page: 3, pageSize: 20 }));
    const req = httpTesting.expectOne('/api/v1/imports/500/errors?page=3&pageSize=20');
    expect(req.request.method).toBe('GET');
    req.flush(page);
    expect(await result).toEqual(page);
  });

  it('confirm() POSTs the body to /imports/:id/confirm', async () => {
    const done = importDetail({ status: 'completed', insertedCount: 100 });
    const result = firstValueFrom(service.confirm('500', { skipErrorRows: true }));
    const req = httpTesting.expectOne('/api/v1/imports/500/confirm');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ skipErrorRows: true });
    req.flush(done);
    expect(await result).toEqual(done);
  });

  it('confirm() sends an empty body by default', () => {
    service.confirm('500').subscribe();
    const req = httpTesting.expectOne('/api/v1/imports/500/confirm');
    expect(req.request.body).toEqual({});
    req.flush(importDetail({ status: 'completed' }));
  });

  it('retry() and cancel() POST to their endpoints', async () => {
    const retried = firstValueFrom(service.retry('500'));
    const retryReq = httpTesting.expectOne('/api/v1/imports/500/retry');
    expect(retryReq.request.method).toBe('POST');
    retryReq.flush(importDetail({ status: 'completed' }));
    expect((await retried).status).toBe('completed');

    const cancelled = firstValueFrom(service.cancel('500'));
    const cancelReq = httpTesting.expectOne('/api/v1/imports/500/cancel');
    expect(cancelReq.request.method).toBe('POST');
    cancelReq.flush(importDetail({ status: 'cancelled' }));
    expect((await cancelled).status).toBe('cancelled');
  });

  it('maps a 409 on confirm to an ApiError', async () => {
    const result = firstValueFrom(service.confirm('500'));
    httpTesting
      .expectOne('/api/v1/imports/500/confirm')
      .flush(errorBody('CONFLICT', 'Tick skipErrorRows to skip the 3 rows with errors.'), {
        status: 409,
        statusText: 'Conflict',
      });
    await expect(result).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('encodes ids in the path', () => {
    service.get('1/../2').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/imports/1%2F..%2F2').flush(importDetail());
    service.list('1/2').subscribe();
    httpTesting.expectOne('/api/v1/accounts/1%2F2/imports').flush(paged([]));
  });
});
