import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HealthResponse } from '../../../core/health/health.models';
import { ApiStatus } from './api-status';

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

describe('ApiStatus', () => {
  let fixture: ComponentFixture<ApiStatus>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const panel = () => host().querySelector('section') as HTMLElement;
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const statusText = () => text(host().querySelector('[role="status"]'));
  const lastChecked = () => host().querySelector('time');
  const checkAgainButton = () => host().querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ApiStatus],
      providers: [provideHttpClient(withFetch()), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ApiStatus);
    fixture.detectChanges();
  });

  afterEach(() => httpTesting.verify());

  it('renders the loading state while the first check is in flight', () => {
    expect(panel().dataset['state']).toBe('loading');
    expect(panel().getAttribute('aria-busy')).toBe('true');
    expect(statusText()).toContain('Checking the API and database');
    expect(text(host())).toContain('Last checked: not yet');
    expect(checkAgainButton().getAttribute('aria-disabled')).toBe('true');

    httpTesting.expectOne('/api/v1/health').flush(OK_BODY);
  });

  it('renders the ok state (API up, DB up) with the last-checked time', () => {
    httpTesting.expectOne('/api/v1/health').flush(OK_BODY);
    fixture.detectChanges();

    expect(panel().dataset['state']).toBe('ok');
    expect(panel().getAttribute('aria-busy')).toBe('false');
    expect(statusText()).toContain('Operational');
    expect(statusText()).toContain('API is up. Database is up.');
    expect(lastChecked()?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(checkAgainButton().hasAttribute('aria-disabled')).toBe(false);
  });

  it('renders the degraded state (API up, DB down) for a 503 health body', () => {
    httpTesting
      .expectOne('/api/v1/health')
      .flush(DEGRADED_BODY, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();

    expect(panel().dataset['state']).toBe('degraded');
    expect(statusText()).toContain('Degraded');
    expect(statusText()).toContain('API is up, but the database is down.');
    expect(lastChecked()).not.toBeNull();
  });

  it('renders the unreachable state (API down) with the reason', () => {
    httpTesting.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(panel().dataset['state']).toBe('unreachable');
    expect(statusText()).toContain('Unreachable');
    expect(statusText()).toContain('The API could not be reached.');
    expect(statusText()).toContain('No response from the API (network error).');
    expect(lastChecked()).not.toBeNull();
  });

  it('"Check again" sends a new request and shows the new result', () => {
    httpTesting.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(panel().dataset['state']).toBe('unreachable');

    checkAgainButton().click();
    fixture.detectChanges();

    expect(panel().dataset['state']).toBe('loading');
    const retry = httpTesting.expectOne('/api/v1/health');
    retry.flush(OK_BODY);
    fixture.detectChanges();

    expect(panel().dataset['state']).toBe('ok');
  });

  it('ignores "Check again" while a check is already in flight', () => {
    checkAgainButton().click();
    fixture.detectChanges();

    httpTesting.expectOne('/api/v1/health').flush(OK_BODY);
  });
});
