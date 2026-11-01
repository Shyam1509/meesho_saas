import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  EXPENSE_CATEGORIES,
  errorBody,
  expense,
  expenseList,
} from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { ExpensesApiService } from './expenses-api.service';

describe('ExpensesApiService', () => {
  let service: ExpensesApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ExpensesApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('categories() GETs /expenses/categories', async () => {
    const result = firstValueFrom(service.categories());
    httpTesting
      .expectOne({ method: 'GET', url: '/api/v1/expenses/categories' })
      .flush({ items: EXPENSE_CATEGORIES });
    expect((await result).items.map((c) => c.key)).toEqual(['packaging', 'staff', 'other']);
  });

  describe('listForAccount()', () => {
    it('GETs the account’s expenses with no parameters by default', async () => {
      const result = firstValueFrom(service.listForAccount('100'));
      const req = httpTesting.expectOne('/api/v1/accounts/100/expenses');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toEqual([]);
      req.flush(expenseList([expense()]));
      expect((await result).totals).toEqual({ amount: '1200.50', count: 1 });
    });

    it('sends every filter, each category as its own repeated parameter', () => {
      service
        .listForAccount('100', {
          page: 2,
          pageSize: 25,
          sort: 'amount',
          from: '2026-10-01',
          to: '2026-10-31',
          category: ['packaging', 'other'],
        })
        .subscribe();
      const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/expenses');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/expenses?page=2&pageSize=25&sort=amount&from=2026-10-01&to=2026-10-31&category=packaging&category=other',
      );
      req.flush(expenseList([]));
    });
  });

  describe('listForWorkspace()', () => {
    it('GETs the workspace’s expenses, sending scope only when given', () => {
      service.listForWorkspace('10').subscribe();
      const plain = httpTesting.expectOne('/api/v1/workspaces/10/expenses');
      expect(plain.request.params.keys()).toEqual([]);
      plain.flush(expenseList([]));

      service.listForWorkspace('10', { scope: 'all', category: [], sort: '-expenseDate' }).subscribe();
      const all = httpTesting.expectOne((r) => r.url === '/api/v1/workspaces/10/expenses');
      expect(all.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/expenses?sort=-expenseDate&scope=all',
      );
      all.flush(expenseList([]));
    });

    it('maps a 400 with field details to an ApiError', async () => {
      const result = firstValueFrom(service.listForWorkspace('10', { from: '2026-10-01' }));
      httpTesting
        .expectOne((r) => r.url === '/api/v1/workspaces/10/expenses')
        .flush(
          errorBody('VALIDATION_ERROR', 'Invalid query.', [{ field: 'category', reasons: ['bad'] }]),
          { status: 400, statusText: 'Bad Request' },
        );
      const error = (await result.catch((e: unknown) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.reasonsFor('category')).toEqual(['bad']);
    });
  });

  it('createForAccount() and createForWorkspace() POST the body to the right list', async () => {
    const body = { expenseDate: '2026-10-05', category: 'packaging', amount: '1200.50' };
    const account = firstValueFrom(service.createForAccount('100', body));
    const accountReq = httpTesting.expectOne({
      method: 'POST',
      url: '/api/v1/accounts/100/expenses',
    });
    expect(accountReq.request.body).toEqual(body);
    accountReq.flush(expense(), { status: 201, statusText: 'Created' });
    expect((await account).id).toBe('900');

    const workspace = firstValueFrom(
      service.createForWorkspace('10', { ...body, category: 'other', description: 'Rent' }),
    );
    const workspaceReq = httpTesting.expectOne({
      method: 'POST',
      url: '/api/v1/workspaces/10/expenses',
    });
    expect(workspaceReq.request.body).toEqual({ ...body, category: 'other', description: 'Rent' });
    workspaceReq.flush(expense({ id: '901', scope: 'workspace', sellerAccountId: null }));
    expect((await workspace).scope).toBe('workspace');
  });

  it('update() PATCHes only the changed fields; null clears the description', async () => {
    const result = firstValueFrom(service.update('900', { description: null, amount: '99' }));
    const req = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/expenses/900' });
    expect(req.request.body).toEqual({ description: null, amount: '99' });
    req.flush(expense({ description: null, amount: '99.00' }));
    expect((await result).amount).toBe('99.00');
  });

  it('delete() DELETEs the expense and resolves on a 204; a 403 becomes an ApiError', async () => {
    const result = firstValueFrom(service.delete('900'));
    httpTesting
      .expectOne({ method: 'DELETE', url: '/api/v1/expenses/900' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeUndefined();

    const forbidden = firstValueFrom(service.delete('9 0'));
    httpTesting
      .expectOne('/api/v1/expenses/9%200')
      .flush(errorBody('FORBIDDEN', 'Only owners can do this.'), {
        status: 403,
        statusText: 'Forbidden',
      });
    await expect(forbidden).rejects.toMatchObject({ status: 403 });
  });
});
