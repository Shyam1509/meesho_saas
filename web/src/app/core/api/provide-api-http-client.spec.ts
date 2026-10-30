import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { appConfig } from '../../app.config';
import { AuthStateService } from '../auth/auth-state.service';
import { ME_OWNER, clearXsrfCookie, setXsrfCookie } from '../../../testing/test-data';

describe('app HTTP configuration', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
    // The app initializer asks the API who is signed in before anything else.
    httpTesting.expectOne({ method: 'GET', url: '/api/v1/auth/me' }).flush(ME_OWNER);
    await TestBed.inject(ApplicationInitStatus).donePromise;
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
  });

  it('loads the session at startup', () => {
    expect(TestBed.inject(AuthStateService).status()).toBe('authenticated');
  });

  it('copies the msaas_xsrf cookie into X-XSRF-TOKEN on unsafe requests only', () => {
    setXsrfCookie('token-1');

    http.post('/api/v1/workspaces', { name: 'X' }).subscribe();
    http.patch('/api/v1/accounts/1', {}).subscribe();
    http.delete('/api/v1/accounts/1').subscribe();
    http.get('/api/v1/workspaces').subscribe();

    const [post, patch, del, get] = [
      httpTesting.expectOne({ method: 'POST', url: '/api/v1/workspaces' }),
      httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/accounts/1' }),
      httpTesting.expectOne({ method: 'DELETE', url: '/api/v1/accounts/1' }),
      httpTesting.expectOne({ method: 'GET', url: '/api/v1/workspaces' }),
    ];
    expect(post.request.headers.get('X-XSRF-TOKEN')).toBe('token-1');
    expect(patch.request.headers.get('X-XSRF-TOKEN')).toBe('token-1');
    expect(del.request.headers.get('X-XSRF-TOKEN')).toBe('token-1');
    expect(get.request.headers.has('X-XSRF-TOKEN')).toBe(false);
    for (const req of [post, patch, del, get]) {
      req.flush({});
    }
  });

  it('never sends the token to another origin', () => {
    setXsrfCookie('token-1');
    http.post('https://elsewhere.example/api', {}).subscribe();
    const req = httpTesting.expectOne('https://elsewhere.example/api');
    expect(req.request.headers.has('X-XSRF-TOKEN')).toBe(false);
    req.flush({});
  });
});
