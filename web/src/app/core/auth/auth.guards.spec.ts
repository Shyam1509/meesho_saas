import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { ME_OWNER, errorBody } from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { AuthStateService } from './auth-state.service';
import { authGuard, guestGuard, registrationEnabledGuard } from './auth.guards';

@Component({ template: '' })
class Blank {}

describe('auth guards', () => {
  let router: Router;
  let auth: AuthStateService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Blank, canActivate: [guestGuard] },
          {
            path: 'register',
            component: Blank,
            canActivate: [guestGuard, registrationEnabledGuard],
          },
          {
            path: '',
            component: Blank,
            canActivate: [authGuard],
            canActivateChild: [authGuard],
            children: [
              { path: 'overview', component: Blank },
              { path: 'orders', component: Blank },
            ],
          },
        ]),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthStateService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('authGuard', () => {
    it('lets a signed-in user through', async () => {
      auth.setSession(ME_OWNER);
      expect(await router.navigateByUrl('/orders?page=2')).toBe(true);
      expect(router.url).toBe('/orders?page=2');
    });

    it('sends a signed-out user to /login with the attempted URL as returnUrl', async () => {
      auth.clear();
      await router.navigateByUrl('/orders?page=2');
      expect(router.url).toBe('/login?returnUrl=%2Forders%3Fpage%3D2');
    });

    it('asks the API first when the status is still unknown', async () => {
      const navigation = router.navigateByUrl('/overview');
      await vi.waitFor(() =>
        httpTesting
          .expectOne('/api/v1/auth/me')
          .flush(errorBody('UNAUTHORIZED', 'Authentication required.'), {
            status: 401,
            statusText: 'Unauthorized',
          }),
      );
      await navigation;
      expect(router.url).toBe('/login?returnUrl=%2Foverview');
    });

    it('re-checks on navigation between shell pages (canActivateChild)', async () => {
      auth.setSession(ME_OWNER);
      await router.navigateByUrl('/overview');
      auth.clear();
      await router.navigateByUrl('/orders');
      expect(router.url).toBe('/login?returnUrl=%2Forders');
    });
  });

  describe('guestGuard', () => {
    it('lets a signed-out visitor see /login', async () => {
      auth.clear();
      expect(await router.navigateByUrl('/login')).toBe(true);
      expect(router.url).toBe('/login');
    });

    it('sends a signed-in user to a safe returnUrl', async () => {
      auth.setSession(ME_OWNER);
      await router.navigateByUrl('/login?returnUrl=%2Forders');
      expect(router.url).toBe('/orders');
    });

    it.each([
      ['an absolute URL', 'https://evil.example'],
      ['a protocol-relative URL', '//evil.example'],
      ['a backslash URL', '/\\evil.example'],
    ])('ignores %s as returnUrl and uses /overview', async (_label, returnUrl) => {
      auth.setSession(ME_OWNER);
      await router.navigateByUrl(router.createUrlTree(['/login'], { queryParams: { returnUrl } }));
      expect(router.url).toBe('/overview');
    });
  });

  describe('registrationEnabledGuard', () => {
    it('allows /register while registration is enabled', async () => {
      auth.clear();
      const navigation = router.navigateByUrl('/register');
      await vi.waitFor(() =>
        httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled: true }),
      );
      expect(await navigation).toBe(true);
      expect(router.url).toBe('/register');
    });

    it('redirects to /login while registration is disabled', async () => {
      auth.clear();
      const navigation = router.navigateByUrl('/register');
      await vi.waitFor(() =>
        httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled: false }),
      );
      await navigation;
      expect(router.url).toBe('/login');
    });
  });
});
