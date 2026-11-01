import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { accountDashboard, errorBody, workspaceDashboard } from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { DashboardApiService } from './dashboard-api.service';

describe('DashboardApiService', () => {
  let service: DashboardApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('forAccount() GETs the account dashboard with no parameters by default', async () => {
    const result = firstValueFrom(service.forAccount('100'));
    const req = httpTesting.expectOne({ method: 'GET', url: '/api/v1/accounts/100/dashboard' });
    expect(req.request.params.keys()).toEqual([]);
    req.flush(accountDashboard());
    expect((await result).contribution.amount).toBe('330.40');
  });

  it('sends every filter, each status as its own repeated parameter', () => {
    service
      .forAccount('100', {
        from: '2026-10-01',
        to: '2026-10-31',
        basis: 'payment_date',
        status: ['Delivered', 'RTO Complete'],
        granularity: 'week',
      })
      .subscribe();
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/dashboard');
    expect(req.request.params.getAll('status')).toEqual(['Delivered', 'RTO Complete']);
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/dashboard?from=2026-10-01&to=2026-10-31&basis=payment_date&status=Delivered&status=RTO%20Complete&granularity=week',
    );
    req.flush(accountDashboard());
  });

  it('leaves out an empty status list and undefined values', () => {
    service.forAccount('100', { status: [], granularity: undefined }).subscribe();
    const req = httpTesting.expectOne('/api/v1/accounts/100/dashboard');
    expect(req.request.params.keys()).toEqual([]);
    req.flush(accountDashboard());
  });

  it('forWorkspace() GETs the workspace dashboard, encoding the id', async () => {
    const result = firstValueFrom(
      service.forWorkspace('10', { from: '2026-10-01', to: '2026-10-07', basis: 'order_date' }),
    );
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/workspaces/10/dashboard');
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toBe(
      '/api/v1/workspaces/10/dashboard?from=2026-10-01&to=2026-10-07&basis=order_date',
    );
    req.flush(workspaceDashboard());
    expect((await result).accounts?.length).toBe(3);

    service.forWorkspace('1 0').subscribe({ error: () => undefined });
    httpTesting
      .expectOne('/api/v1/workspaces/1%200/dashboard')
      .flush(errorBody('NOT_FOUND', 'Workspace not found.'), {
        status: 404,
        statusText: 'Not Found',
      });
  });

  it('maps a 400 (range too long) to an ApiError with the server message', async () => {
    const result = firstValueFrom(service.forAccount('100', { from: '2020-01-01', to: '2026-10-31' }));
    httpTesting
      .expectOne((r) => r.url === '/api/v1/accounts/100/dashboard')
      .flush(
        errorBody('VALIDATION_ERROR', 'The range can be at most 731 days.', [
          { field: 'to', reasons: ['range longer than 731 days'] },
        ]),
        { status: 400, statusText: 'Bad Request' },
      );
    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('The range can be at most 731 days.');
    expect(error.reasonsFor('to')).toEqual(['range longer than 731 days']);
  });
});
