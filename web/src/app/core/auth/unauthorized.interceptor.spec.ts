import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ME_OWNER, errorBody } from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { SELECTED_WORKSPACE_STORAGE_KEY } from '../workspaces/selected-workspace.store';
import { AuthStateService } from './auth-state.service';

@Component({ template: '' })
class Blank {}

const UNAUTHORIZED = { status: 401, statusText: 'Unauthorized' };
const BODY_401 = errorBody('UNAUTHORIZED', 'Authentication required.');

describe('unauthorizedInterceptor', () => {
  let http: HttpClient;
  let router: Router;
  let auth: AuthStateService;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '10');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Blank },
          { path: 'seller-accounts', component: Blank },
        ]),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthStateService);
    httpTesting = TestBed.inject(HttpTestingController);

    auth.setSession(ME_OWNER);
    await router.navigateByUrl('/seller-accounts?tab=all');
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('on a 401 from a guarded call: signs out, goes to /login with returnUrl, rethrows', async () => {
    const result = firstValueFrom(http.get('/api/v1/workspaces/10/accounts'));
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush(BODY_401, UNAUTHORIZED);

    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.status()).toBe('anonymous');
    expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
    await vi.waitFor(() =>
      expect(router.url).toBe('/login?returnUrl=%2Fseller-accounts%3Ftab%3Dall'),
    );
  });

  it.each(['/api/v1/auth/me', '/api/v1/auth/login', '/api/v1/auth/register'])(
    'leaves a 401 from %s to the caller',
    async (url) => {
      const result = firstValueFrom(http.post(url, {}));
      httpTesting.expectOne(url).flush(BODY_401, UNAUTHORIZED);

      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(auth.status()).toBe('authenticated');
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('10');
      expect(router.url).toBe('/seller-accounts?tab=all');
    },
  );

  it('ignores 401s from outside the API and other error statuses', async () => {
    const foreign = firstValueFrom(http.get('/assets/config.json'));
    httpTesting.expectOne('/assets/config.json').flush('', UNAUTHORIZED);
    await expect(foreign).rejects.toMatchObject({ status: 401 });

    const forbidden = firstValueFrom(http.patch('/api/v1/workspaces/10', { name: 'X' }));
    httpTesting
      .expectOne('/api/v1/workspaces/10')
      .flush(errorBody('FORBIDDEN', 'Forbidden'), { status: 403, statusText: 'Forbidden' });
    await expect(forbidden).rejects.toMatchObject({ status: 403 });

    expect(auth.status()).toBe('authenticated');
    expect(router.url).toBe('/seller-accounts?tab=all');
  });

  it('adds no returnUrl when the 401 happens on the sign-in page itself', async () => {
    auth.clear();
    await router.navigateByUrl('/login');
    const result = firstValueFrom(http.get('/api/v1/workspaces'));
    httpTesting.expectOne('/api/v1/workspaces').flush(BODY_401, UNAUTHORIZED);
    await expect(result).rejects.toBeTruthy();
    await vi.waitFor(() => expect(router.url).toBe('/login'));
  });
});
