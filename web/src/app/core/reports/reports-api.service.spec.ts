import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorBody } from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { ReportsApiService, filenameFromDisposition } from './reports-api.service';

/** A JSON error envelope as a Blob request receives it. */
function blobBody(body: unknown): Blob {
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}

describe('ReportsApiService', () => {
  let service: ReportsApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReportsApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('ordersCsv() GETs the file as a Blob with every filter, statuses repeated, and the server’s file name', async () => {
    const result = firstValueFrom(
      service.ordersCsv('100', {
        status: ['Delivered', 'RTO Complete'],
        from: '2026-10-01',
        to: '2026-10-31',
        q: 'SO-1',
        settlement: 'unmatched',
      }),
    );
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/reports/orders.csv');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.getAll('status')).toEqual(['Delivered', 'RTO Complete']);
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/orders.csv?status=Delivered&status=RTO%20Complete&from=2026-10-01&to=2026-10-31&q=SO-1&settlement=unmatched',
    );
    const csv = new Blob(['﻿Sub order no.\r\n'], { type: 'text/csv' });
    req.flush(csv, {
      headers: {
        'Content-Disposition': 'attachment; filename="Main-store-orders-2026-10-01_2026-10-31.csv"',
      },
    });
    const file = await result;
    expect(file.filename).toBe('Main-store-orders-2026-10-01_2026-10-31.csv');
    expect(file.blob).toBe(csv);
  });

  it('ordersCsv() sends the payment-date range, and nothing for an empty query', () => {
    service.ordersCsv('100', { paymentFrom: '2026-10-01', paymentTo: '2026-10-15' }).subscribe();
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/reports/orders.csv');
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/orders.csv?paymentFrom=2026-10-01&paymentTo=2026-10-15',
    );
    req.flush(new Blob(['x']));

    service.ordersCsv('100', { status: [] }).subscribe();
    const bare = httpTesting.expectOne('/api/v1/accounts/100/reports/orders.csv');
    expect(bare.request.params.keys()).toEqual([]);
    bare.flush(new Blob(['x']));
  });

  it('settlementsCsv() sends entry types repeated, dateBasis, match and includeSuperseded=true only when set', async () => {
    service
      .settlementsCsv('100', {
        entryType: ['order_payment', 'ads_cost'],
        from: '2026-10-01',
        to: '2026-10-31',
        dateBasis: 'order_date',
        match: 'unmatched',
        includeSuperseded: true,
      })
      .subscribe();
    const req = httpTesting.expectOne(
      (r) => r.url === '/api/v1/accounts/100/reports/settlements.csv',
    );
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/settlements.csv?entryType=order_payment&entryType=ads_cost&from=2026-10-01&to=2026-10-31&dateBasis=order_date&match=unmatched&includeSuperseded=true',
    );
    req.flush(new Blob(['x']));

    const result = firstValueFrom(service.settlementsCsv('100', { includeSuperseded: false }));
    const bare = httpTesting.expectOne('/api/v1/accounts/100/reports/settlements.csv');
    expect(bare.request.params.keys()).toEqual([]);
    bare.flush(new Blob(['x']));
    expect((await result).filename).toBe('settlements.csv');
  });

  it('accountExpensesCsv() and workspaceExpensesCsv() send dates, repeated categories and the scope', () => {
    service
      .accountExpensesCsv('100', {
        from: '2026-10-01',
        to: '2026-10-31',
        category: ['packaging', 'rent'],
      })
      .subscribe();
    const account = httpTesting.expectOne(
      (r) => r.url === '/api/v1/accounts/100/reports/expenses.csv',
    );
    expect(account.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/expenses.csv?from=2026-10-01&to=2026-10-31&category=packaging&category=rent',
    );
    account.flush(new Blob(['x']));

    service.workspaceExpensesCsv('10', { from: '2026-10-01', scope: 'all' }).subscribe();
    const workspace = httpTesting.expectOne(
      (r) => r.url === '/api/v1/workspaces/10/reports/expenses.csv',
    );
    expect(workspace.request.urlWithParams).toBe(
      '/api/v1/workspaces/10/reports/expenses.csv?from=2026-10-01&scope=all',
    );
    workspace.flush(new Blob(['x']));
  });

  it('maps a 422 to an ApiError with the server’s message, read from the Blob body', async () => {
    const result = firstValueFrom(service.ordersCsv('100'));
    httpTesting
      .expectOne('/api/v1/accounts/100/reports/orders.csv')
      .flush(
        blobBody(
          errorBody(
            'TOO_MANY_ROWS',
            'This export has 120000 rows, more than the 100000 allowed. Narrow the filters.',
          ),
        ),
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('TOO_MANY_ROWS');
    expect(error.message).toBe(
      'This export has 120000 rows, more than the 100000 allowed. Narrow the filters.',
    );
  });

  it('maps a body that is not JSON to the generic message, and a network error to NETWORK_ERROR', async () => {
    const bad = firstValueFrom(service.ordersCsv('100'));
    httpTesting
      .expectOne('/api/v1/accounts/100/reports/orders.csv')
      .flush(new Blob(['<html>Oops</html>']), { status: 500, statusText: 'Server Error' });
    const badError = (await bad.catch((e: unknown) => e)) as ApiError;
    expect(badError.status).toBe(500);
    expect(badError.message).toBe('The server returned an unexpected response (HTTP 500).');

    // A proxy's 502 page (the API is down) reads as "Can't reach the server".
    const gateway = firstValueFrom(service.ordersCsv('100'));
    httpTesting
      .expectOne('/api/v1/accounts/100/reports/orders.csv')
      .flush(new Blob(['<html>Bad gateway</html>']), { status: 502, statusText: 'Bad Gateway' });
    const gatewayError = (await gateway.catch((e: unknown) => e)) as ApiError;
    expect(gatewayError.status).toBe(502);
    expect(gatewayError.message).toBe(
      "Can't reach the server. Check your connection and try again.",
    );

    const offline = firstValueFrom(service.ordersCsv('100'));
    httpTesting.expectOne('/api/v1/accounts/100/reports/orders.csv').error(new ProgressEvent('error'));
    const offlineError = (await offline.catch((e: unknown) => e)) as ApiError;
    expect(offlineError.code).toBe('NETWORK_ERROR');
  });

  it('reads the file name from Content-Disposition, preferring filename*, without any path', () => {
    expect(filenameFromDisposition('attachment; filename="a-orders.csv"')).toBe('a-orders.csv');
    expect(filenameFromDisposition('attachment; filename=plain.csv')).toBe('plain.csv');
    expect(
      filenameFromDisposition(
        `attachment; filename="fallback.csv"; filename*=UTF-8''Main%20store-orders.csv`,
      ),
    ).toBe('Main store-orders.csv');
    expect(filenameFromDisposition('attachment; filename="../../etc/x.csv"')).toBe('x.csv');
    expect(filenameFromDisposition('attachment')).toBeNull();
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
