import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import {
  ApiUnreachableError,
  HEALTH_CHECK_TIMEOUT_MS,
  HealthApiService,
} from './health-api.service';
import { HealthCheckResult, HealthResponse } from './health.models';

const OK_BODY: HealthResponse = {
  status: 'ok',
  db: 'up',
  uptimeSeconds: 42,
  timestamp: '2026-10-29T10:00:00.000Z',
};

const DEGRADED_BODY: HealthResponse = {
  status: 'degraded',
  db: 'down',
  uptimeSeconds: 43,
  timestamp: '2026-10-29T10:00:01.000Z',
};

describe('HealthApiService', () => {
  let service: HealthApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch()), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('GETs /api/v1/health and emits the body on 200', async () => {
    const health = firstValueFrom(service.getHealth());

    const req = httpTesting.expectOne('/api/v1/health');
    expect(req.request.method).toBe('GET');
    req.flush(OK_BODY);

    expect(await health).toEqual(OK_BODY);
  });

  it('classifies 200 ok / db up as "ok"', async () => {
    const result = firstValueFrom(service.checkHealth());

    httpTesting.expectOne('/api/v1/health').flush(OK_BODY);

    expect(await result).toEqual<HealthCheckResult>({ kind: 'ok', health: OK_BODY });
  });

  it('treats a 503 with a health body as a degraded result, not an error', async () => {
    const health = firstValueFrom(service.getHealth());
    httpTesting
      .expectOne('/api/v1/health')
      .flush(DEGRADED_BODY, { status: 503, statusText: 'Service Unavailable' });
    expect(await health).toEqual(DEGRADED_BODY);

    const result = firstValueFrom(service.checkHealth());
    httpTesting
      .expectOne('/api/v1/health')
      .flush(DEGRADED_BODY, { status: 503, statusText: 'Service Unavailable' });
    expect(await result).toEqual<HealthCheckResult>({ kind: 'degraded', health: DEGRADED_BODY });
  });

  it('maps a network error to "unreachable"', async () => {
    const health = firstValueFrom(service.getHealth());
    httpTesting.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    await expect(health).rejects.toBeInstanceOf(ApiUnreachableError);

    const result = firstValueFrom(service.checkHealth());
    httpTesting.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    expect(await result).toEqual<HealthCheckResult>({
      kind: 'unreachable',
      reason: 'No response from the API (network error).',
    });
  });

  it('maps an error envelope (non-health body) to "unreachable" and keeps the request ID', async () => {
    const result = firstValueFrom(service.checkHealth());

    httpTesting
      .expectOne('/api/v1/health')
      .flush(
        { error: { code: 'INTERNAL', message: 'Boom', requestId: 'req-123' } },
        { status: 500, statusText: 'Internal Server Error' },
      );

    expect(await result).toEqual<HealthCheckResult>({
      kind: 'unreachable',
      reason: 'The health check failed with HTTP 500 (request ID req-123).',
    });
  });

  it('maps a 200 whose body is not a health response to "unreachable"', async () => {
    const result = firstValueFrom(service.checkHealth());

    httpTesting.expectOne('/api/v1/health').flush('<!doctype html><html></html>');

    expect((await result).kind).toBe('unreachable');
  });

  it('maps a 503 without a health body to "unreachable"', async () => {
    const result = firstValueFrom(service.checkHealth());

    httpTesting
      .expectOne('/api/v1/health')
      .flush({ status: 'degraded' }, { status: 503, statusText: 'Service Unavailable' });

    expect(await result).toEqual<HealthCheckResult>({
      kind: 'unreachable',
      reason: 'The health check failed with HTTP 503.',
    });
  });

  it('maps no answer within the timeout to "unreachable"', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(service.checkHealth());
    const req = httpTesting.expectOne('/api/v1/health');

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);

    expect(await result).toEqual<HealthCheckResult>({
      kind: 'unreachable',
      reason: 'The API did not answer within 10 seconds.',
    });
    expect(req.cancelled).toBe(true);
  });

  it('uses the API_BASE_URL token', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.example.test/v9' },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    const health = firstValueFrom(TestBed.inject(HealthApiService).getHealth());

    httpTesting.expectOne('http://api.example.test/v9/health').flush(OK_BODY);

    expect(await health).toEqual(OK_BODY);
  });
});
