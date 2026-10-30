import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorBody, sellerAccount } from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { SellerAccountsApiService } from './seller-accounts-api.service';

describe('SellerAccountsApiService', () => {
  let service: SellerAccountsApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SellerAccountsApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('list() GETs /workspaces/:id/accounts and unwraps items', async () => {
    const result = firstValueFrom(service.list('10'));
    const req = httpTesting.expectOne('/api/v1/workspaces/10/accounts');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [sellerAccount()] });
    expect(await result).toEqual([sellerAccount()]);
  });

  it('get() GETs /accounts/:id', async () => {
    const result = firstValueFrom(service.get('100'));
    const req = httpTesting.expectOne('/api/v1/accounts/100');
    expect(req.request.method).toBe('GET');
    req.flush(sellerAccount());
    expect(await result).toEqual(sellerAccount());
  });

  it('create() POSTs the body to /workspaces/:id/accounts', async () => {
    const result = firstValueFrom(
      service.create('10', { displayName: 'Main store', meeshoSupplierId: 'SUP_001' }),
    );
    const req = httpTesting.expectOne('/api/v1/workspaces/10/accounts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ displayName: 'Main store', meeshoSupplierId: 'SUP_001' });
    req.flush(sellerAccount(), { status: 201, statusText: 'Created' });
    expect(await result).toEqual(sellerAccount());
  });

  it('update() PATCHes only the given fields to /accounts/:id', async () => {
    const result = firstValueFrom(service.update('100', { meeshoSupplierId: null }));
    const req = httpTesting.expectOne('/api/v1/accounts/100');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ meeshoSupplierId: null });
    req.flush(sellerAccount({ meeshoSupplierId: null }));
    expect((await result).meeshoSupplierId).toBeNull();
  });

  it('disable() sends DELETE /accounts/:id and returns the disabled account', async () => {
    const result = firstValueFrom(service.disable('100'));
    const req = httpTesting.expectOne('/api/v1/accounts/100');
    expect(req.request.method).toBe('DELETE');
    req.flush(sellerAccount({ status: 'disabled' }));
    expect((await result).status).toBe('disabled');
  });

  it('maps a 409 with field details to an ApiError', async () => {
    const result = firstValueFrom(service.create('10', { displayName: 'Main store' }));
    httpTesting
      .expectOne('/api/v1/workspaces/10/accounts')
      .flush(
        errorBody('CONFLICT', 'A seller account with this name already exists.', [
          { field: 'displayName', reasons: ['is already used in this workspace'] },
        ]),
        { status: 409, statusText: 'Conflict' },
      );
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.reasonsFor('displayName')).toEqual(['is already used in this workspace']);
  });
});
