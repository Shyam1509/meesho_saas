import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  errorBody,
  orderDetail,
  orderSummary,
  paged,
  statusEvent,
} from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { OrdersApiService } from './orders-api.service';

describe('OrdersApiService', () => {
  let service: OrdersApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrdersApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('list()', () => {
    it('GETs the account’s orders with no parameters by default', async () => {
      const result = firstValueFrom(service.list('100'));
      const req = httpTesting.expectOne('/api/v1/accounts/100/orders');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toEqual([]);
      req.flush(paged([orderSummary()], 1, 1, 25));
      expect((await result).items).toEqual([orderSummary()]);
    });

    it('sends every filter, each status as its own repeated parameter', () => {
      service
        .list('100', {
          page: 2,
          pageSize: 25,
          sort: 'subOrderNo',
          status: ['Delivered', 'RTO Complete'],
          from: '2026-10-01',
          to: '2026-10-31',
          q: 'SO-10',
          settlement: 'unmatched',
        })
        .subscribe();
      const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/orders');
      expect(req.request.params.getAll('status')).toEqual(['Delivered', 'RTO Complete']);
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/orders?page=2&pageSize=25&sort=subOrderNo&status=Delivered&status=RTO%20Complete&from=2026-10-01&to=2026-10-31&q=SO-10&settlement=unmatched',
      );
      req.flush(paged([], 2, 26, 25));
    });

    it('leaves out an empty status list, empty text and undefined values', () => {
      service.list('100', { status: [], q: '', from: undefined }).subscribe();
      const req = httpTesting.expectOne('/api/v1/accounts/100/orders');
      expect(req.request.params.keys()).toEqual([]);
      req.flush(paged([]));
    });

    it('maps a 400 to an ApiError with field details', async () => {
      const result = firstValueFrom(service.list('100', { sort: '-orderDate' }));
      httpTesting
        .expectOne((r) => r.url === '/api/v1/accounts/100/orders')
        .flush(
          errorBody('VALIDATION_ERROR', 'Invalid query.', [{ field: 'from', reasons: ['bad'] }]),
          { status: 400, statusText: 'Bad Request' },
        );
      const error = (await result.catch((e: unknown) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
      expect(error.reasonsFor('from')).toEqual(['bad']);
    });
  });

  it('statuses() GETs /orders/statuses', async () => {
    const result = firstValueFrom(service.statuses('100'));
    httpTesting
      .expectOne({ method: 'GET', url: '/api/v1/accounts/100/orders/statuses' })
      .flush({ items: [{ status: 'Delivered', count: 3 }] });
    expect(await result).toEqual({ items: [{ status: 'Delivered', count: 3 }] });
  });

  it('get() GETs one order, encoding the ids', async () => {
    const result = firstValueFrom(service.get('100', '9001'));
    httpTesting
      .expectOne({ method: 'GET', url: '/api/v1/accounts/100/orders/9001' })
      .flush(orderDetail());
    expect((await result).subOrderNo).toBe('SO-1001');

    service.get('1 0', 'a/b').subscribe({ error: () => undefined });
    httpTesting
      .expectOne('/api/v1/accounts/1%200/orders/a%2Fb')
      .flush(errorBody('NOT_FOUND', 'Order not found.'), { status: 404, statusText: 'Not Found' });
  });

  it('get() maps a 404 to an ApiError', async () => {
    const result = firstValueFrom(service.get('100', '1'));
    httpTesting
      .expectOne('/api/v1/accounts/100/orders/1')
      .flush(errorBody('NOT_FOUND', 'Order not found.'), { status: 404, statusText: 'Not Found' });
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('statusHistory() GETs /status-history', async () => {
    const result = firstValueFrom(service.statusHistory('100', '9001'));
    httpTesting
      .expectOne({ method: 'GET', url: '/api/v1/accounts/100/orders/9001/status-history' })
      .flush({ items: [statusEvent()] });
    expect((await result).items).toEqual([statusEvent()]);
  });
});
