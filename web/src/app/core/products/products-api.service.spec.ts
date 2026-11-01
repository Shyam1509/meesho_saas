import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  costEntry,
  errorBody,
  paged,
  productDetail,
  productSummary,
} from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { ProductsApiService } from './products-api.service';

describe('ProductsApiService', () => {
  let service: ProductsApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductsApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('list()', () => {
    it('GETs the account’s products with no parameters by default', async () => {
      const result = firstValueFrom(service.list('100'));
      const req = httpTesting.expectOne('/api/v1/accounts/100/products');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toEqual([]);
      req.flush(paged([productSummary()], 1, 1, 25));
      expect((await result).items).toEqual([productSummary()]);
    });

    it('sends every query value in order', () => {
      service
        .list('100', {
          page: 3,
          pageSize: 25,
          sort: '-currentUnitCost',
          q: 'KURTA',
          status: 'all',
          cost: 'missing',
        })
        .subscribe();
      const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/products');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/products?page=3&pageSize=25&sort=-currentUnitCost&q=KURTA&status=all&cost=missing',
      );
      req.flush(paged([], 3, 51, 25));
    });

    it('leaves out empty and undefined values', () => {
      service.list('100', { q: '', cost: undefined }).subscribe();
      const req = httpTesting.expectOne('/api/v1/accounts/100/products');
      expect(req.request.params.keys()).toEqual([]);
      req.flush(paged([]));
    });
  });

  it('create() POSTs the body to the account’s products', async () => {
    const result = firstValueFrom(service.create('100', { sku: 'NEW-1', name: 'New thing' }));
    const req = httpTesting.expectOne({ method: 'POST', url: '/api/v1/accounts/100/products' });
    expect(req.request.body).toEqual({ sku: 'NEW-1', name: 'New thing' });
    req.flush(productDetail({ id: '701', sku: 'NEW-1' }), { status: 201, statusText: 'Created' });
    expect((await result).id).toBe('701');
  });

  it('create() maps a 409 (SKU taken) to an ApiError with its details', async () => {
    const result = firstValueFrom(service.create('100', { sku: 'KURTA-M' }));
    httpTesting
      .expectOne('/api/v1/accounts/100/products')
      .flush(
        errorBody('CONFLICT', 'A product with this SKU already exists.', [
          { field: 'sku', reasons: ['is already used by another product'] },
        ]),
        { status: 409, statusText: 'Conflict' },
      );
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.reasonsFor('sku')).toEqual(['is already used by another product']);
  });

  it('sync() POSTs an empty body to /products/sync', async () => {
    const result = firstValueFrom(service.sync('100'));
    const req = httpTesting.expectOne({
      method: 'POST',
      url: '/api/v1/accounts/100/products/sync',
    });
    expect(req.request.body).toEqual({});
    req.flush({ createdProducts: 3, linkedOrders: 12 });
    expect(await result).toEqual({ createdProducts: 3, linkedOrders: 12 });
  });

  it('get() GETs one product, encoding the id', async () => {
    const result = firstValueFrom(service.get('700'));
    httpTesting
      .expectOne({ method: 'GET', url: '/api/v1/products/700' })
      .flush(productDetail());
    expect((await result).costHistory).toHaveLength(2);

    service.get('a/b').subscribe({ error: () => undefined });
    httpTesting
      .expectOne('/api/v1/products/a%2Fb')
      .flush(errorBody('NOT_FOUND', 'Product not found.'), {
        status: 404,
        statusText: 'Not Found',
      });
  });

  it('update() PATCHes only the given fields (null clears the name)', async () => {
    const result = firstValueFrom(service.update('700', { name: null }));
    const req = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/products/700' });
    expect(req.request.body).toEqual({ name: null });
    req.flush(productDetail({ name: null }));
    expect((await result).name).toBeNull();

    service.update('700', { status: 'archived' }).subscribe();
    const archive = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/products/700' });
    expect(archive.request.body).toEqual({ status: 'archived' });
    archive.flush(productDetail({ status: 'archived' }));
  });

  it('addCost() POSTs the cost row; a 409 (same date) becomes an ApiError', async () => {
    const result = firstValueFrom(
      service.addCost('700', { effectiveFrom: '2026-11-01', unitCost: '260.5', note: 'Nov' }),
    );
    const req = httpTesting.expectOne({
      method: 'POST',
      url: '/api/v1/products/700/cost-history',
    });
    expect(req.request.body).toEqual({
      effectiveFrom: '2026-11-01',
      unitCost: '260.5',
      note: 'Nov',
    });
    req.flush(costEntry({ id: '802' }), { status: 201, statusText: 'Created' });
    expect((await result).id).toBe('802');

    const conflict = firstValueFrom(
      service.addCost('700', { effectiveFrom: '2026-10-01', unitCost: '1' }),
    );
    httpTesting
      .expectOne('/api/v1/products/700/cost-history')
      .flush(errorBody('CONFLICT', 'A cost already starts on this date.'), {
        status: 409,
        statusText: 'Conflict',
      });
    await expect(conflict).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('deleteCost() DELETEs the cost row and resolves on a 204', async () => {
    const result = firstValueFrom(service.deleteCost('700', '801'));
    const req = httpTesting.expectOne({
      method: 'DELETE',
      url: '/api/v1/products/700/cost-history/801',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeUndefined();
  });

  it('deleteCost() maps a 403 (member) to an ApiError', async () => {
    const result = firstValueFrom(service.deleteCost('700', '801'));
    httpTesting
      .expectOne('/api/v1/products/700/cost-history/801')
      .flush(errorBody('FORBIDDEN', 'Only owners can do this.'), {
        status: 403,
        statusText: 'Forbidden',
      });
    await expect(result).rejects.toMatchObject({ status: 403, message: 'Only owners can do this.' });
  });
});
