import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  clearXsrfCookie,
  errorBody,
  orderSummary,
  paged,
  reconciliationOverview,
  runSummary,
  setXsrfCookie,
  settlementEntry,
  unmatchedEntry,
} from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { ReconciliationApiService } from './reconciliation-api.service';

const BASE = '/api/v1/accounts/100/reconciliation';

describe('ReconciliationApiService', () => {
  let service: ReconciliationApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReconciliationApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
  });

  it('overview() GETs /reconciliation', async () => {
    const result = firstValueFrom(service.overview('100'));
    httpTesting.expectOne({ method: 'GET', url: BASE }).flush(reconciliationOverview());
    expect(await result).toEqual(reconciliationOverview());
  });

  it('unmatchedSettlements() GETs with paging and sort', async () => {
    const result = firstValueFrom(
      service.unmatchedSettlements('100', { page: 2, pageSize: 25, sort: '-paymentDate' }),
    );
    httpTesting
      .expectOne(`${BASE}/unmatched-settlements?page=2&pageSize=25&sort=-paymentDate`)
      .flush(paged([unmatchedEntry()], 2, 26, 25));
    expect((await result).items).toEqual([unmatchedEntry()]);
  });

  it('ordersWithoutSettlement() repeats status', () => {
    service
      .ordersWithoutSettlement('100', { page: 1, pageSize: 25, status: ['Shipped', 'Cancelled'] })
      .subscribe();
    const req = httpTesting.expectOne((r) => r.url === `${BASE}/orders-without-settlement`);
    expect(req.request.params.getAll('status')).toEqual(['Shipped', 'Cancelled']);
    expect(req.request.urlWithParams).toBe(
      `${BASE}/orders-without-settlement?page=1&pageSize=25&status=Shipped&status=Cancelled`,
    );
    req.flush(paged([orderSummary()]));
  });

  it('runs() GETs the run history', async () => {
    const result = firstValueFrom(service.runs('100', { page: 1, pageSize: 10 }));
    httpTesting.expectOne(`${BASE}/runs?page=1&pageSize=10`).flush(paged([runSummary()]));
    expect((await result).items).toEqual([runSummary()]);
  });

  it('run() POSTs /runs with the XSRF header and returns the 201 run', async () => {
    setXsrfCookie('token-2');
    const result = firstValueFrom(service.run('100'));
    const req = httpTesting.expectOne({ method: 'POST', url: `${BASE}/runs` });
    expect(req.request.body).toEqual({});
    expect(req.request.headers.get('X-XSRF-TOKEN')).toBe('token-2');
    req.flush(runSummary({ triggerType: 'manual' }), { status: 201, statusText: 'Created' });
    expect((await result).triggerType).toBe('manual');
  });

  it('manualMatch() POSTs { settlementEntryId, orderId }', async () => {
    const result = firstValueFrom(
      service.manualMatch('100', { settlementEntryId: '3002', orderId: '9001' }),
    );
    const req = httpTesting.expectOne({ method: 'POST', url: `${BASE}/manual-match` });
    expect(req.request.body).toEqual({ settlementEntryId: '3002', orderId: '9001' });
    req.flush(settlementEntry({ id: '3002' }));
    expect((await result).id).toBe('3002');
  });

  it.each([
    [404, 'NOT_FOUND', 'Settlement entry not found.'],
    [409, 'CONFLICT', 'A superseded entry cannot be matched.'],
    [403, 'FORBIDDEN', 'Only an owner can do this.'],
  ])('manualMatch() maps a %s to an ApiError', async (status, code, message) => {
    const result = firstValueFrom(
      service.manualMatch('100', { settlementEntryId: '3002', orderId: '9001' }),
    );
    httpTesting.expectOne(`${BASE}/manual-match`).flush(errorBody(code, message), {
      status,
      statusText: 'Error',
    });
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code, error.message]).toEqual([status, code, message]);
  });

  it('manualUnmatch() POSTs { settlementEntryId }', async () => {
    const result = firstValueFrom(service.manualUnmatch('100', { settlementEntryId: '3001' }));
    const req = httpTesting.expectOne({ method: 'POST', url: `${BASE}/manual-unmatch` });
    expect(req.request.body).toEqual({ settlementEntryId: '3001' });
    req.flush(unmatchedEntry({ id: '3001' }));
    expect((await result).match.state).toBe('unmatched');
  });
});
