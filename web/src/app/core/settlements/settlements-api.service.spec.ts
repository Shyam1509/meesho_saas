import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorBody, settlementEntry, settlementList } from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { settlementEntryTypeLabel, matchStateLabel } from './settlement.models';
import { SettlementsApiService } from './settlements-api.service';

describe('SettlementsApiService', () => {
  let service: SettlementsApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SettlementsApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('GETs the account’s settlement entries with no parameters by default', async () => {
    const result = firstValueFrom(service.list('100'));
    const req = httpTesting.expectOne({ method: 'GET', url: '/api/v1/accounts/100/settlements' });
    expect(req.request.params.keys()).toEqual([]);
    req.flush(settlementList([settlementEntry()]));
    const body = await result;
    expect(body.items).toEqual([settlementEntry()]);
    expect(body.totals).toEqual({ settlementAmount: '1180.40', count: 1 });
  });

  it('sends every filter, each entry type as a repeated parameter, includeSuperseded=true', () => {
    service
      .list('100', {
        page: 3,
        pageSize: 25,
        sort: '-settlementAmount',
        entryType: ['order_payment', 'ads_cost'],
        from: '2026-10-01',
        to: '2026-10-15',
        q: 'TXN',
        match: 'account_level',
        includeSuperseded: true,
      })
      .subscribe();
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/settlements');
    expect(req.request.params.getAll('entryType')).toEqual(['order_payment', 'ads_cost']);
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/settlements?page=3&pageSize=25&sort=-settlementAmount&entryType=order_payment&entryType=ads_cost&from=2026-10-01&to=2026-10-15&q=TXN&match=account_level&includeSuperseded=true',
    );
    req.flush(settlementList([]));
  });

  it('sends dateBasis after the dates when given', () => {
    service.list('100', { from: '2026-10-01', to: '2026-10-31', dateBasis: 'order_date' }).subscribe();
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/settlements');
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date',
    );
    req.flush(settlementList([]));
  });

  it('never sends includeSuperseded=false (the API default)', () => {
    service.list('100', { includeSuperseded: false, entryType: [] }).subscribe();
    const req = httpTesting.expectOne('/api/v1/accounts/100/settlements');
    expect(req.request.params.has('includeSuperseded')).toBe(false);
    expect(req.request.params.has('entryType')).toBe(false);
    req.flush(settlementList([]));
  });

  it('maps an error to an ApiError', async () => {
    const result = firstValueFrom(service.list('100'));
    httpTesting
      .expectOne('/api/v1/accounts/100/settlements')
      .flush(errorBody('NOT_FOUND', 'Account not found.'), { status: 404, statusText: 'Not Found' });
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
  });

  it('labels entry types and match states, humanising unknown ones', () => {
    expect(settlementEntryTypeLabel('order_payment')).toBe('Order payment');
    expect(settlementEntryTypeLabel('ads_cost')).toBe('Ads cost');
    expect(settlementEntryTypeLabel('gst_credit')).toBe('Gst credit');
    expect(matchStateLabel('account_level')).toBe('Account-level');
    expect(matchStateLabel('unmatched')).toBe('Unmatched');
  });
});
