import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ME_TWO_WORKSPACES,
  clearXsrfCookie,
  errorBody,
  setXsrfCookie,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { SELECTED_WORKSPACE_STORAGE_KEY } from '../workspaces/selected-workspace.store';
import { AuthStateService } from './auth-state.service';

describe('AuthStateService', () => {
  let auth: AuthStateService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthStateService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
    localStorage.clear();
  });

  describe('bootstrap (load)', () => {
    it('starts unknown', () => {
      expect(auth.status()).toBe('unknown');
      expect(auth.user()).toBeNull();
      expect(auth.workspaces()).toEqual([]);
    });

    it('200 from /auth/me → authenticated with the user and workspaces', async () => {
      const loaded = auth.load();
      httpTesting.expectOne('/api/v1/auth/me').flush(ME_TWO_WORKSPACES);
      await loaded;

      expect(auth.status()).toBe('authenticated');
      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.user()).toEqual(ME_TWO_WORKSPACES.user);
      expect(auth.workspaces()).toEqual(ME_TWO_WORKSPACES.workspaces);
      expect(auth.sessionCheckError()).toBeNull();
    });

    it('401 from /auth/me → anonymous, not an error; the stored workspace is forgotten', async () => {
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');
      const loaded = auth.load();
      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush(errorBody('UNAUTHORIZED', 'Authentication required.'), {
          status: 401,
          statusText: 'Unauthorized',
        });
      await expect(loaded).resolves.toBeUndefined();

      expect(auth.status()).toBe('anonymous');
      expect(auth.user()).toBeNull();
      expect(auth.sessionCheckError()).toBeNull();
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
    });

    it('a network error → anonymous, with the reason kept for the sign-in page', async () => {
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');
      const loaded = auth.load();
      httpTesting.expectOne('/api/v1/auth/me').error(new ProgressEvent('error'));
      await expect(loaded).resolves.toBeUndefined();

      expect(auth.status()).toBe('anonymous');
      expect(auth.sessionCheckError()).toContain("Can't reach the server");
      // The API may just be unreachable: nothing says the session ended.
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');
    });

    it('shares one request between concurrent loads, and ensureLoaded() reuses the answer', async () => {
      const first = auth.load();
      const second = auth.ensureLoaded();
      httpTesting.expectOne('/api/v1/auth/me').flush(ME_TWO_WORKSPACES);
      await Promise.all([first, second]);

      await auth.ensureLoaded();
      httpTesting.expectNone('/api/v1/auth/me');
      expect(auth.status()).toBe('authenticated');
    });
  });

  describe('loadConfig', () => {
    it('caches the answer', async () => {
      const first = auth.loadConfig();
      httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled: true });
      expect(await first).toBe(true);
      expect(auth.registrationEnabled()).toBe(true);

      expect(await auth.loadConfig()).toBe(true);
      httpTesting.expectNone('/api/v1/auth/config');
    });

    it('treats a failure as "registration closed" without caching it', async () => {
      const result = auth.loadConfig();
      httpTesting.expectOne('/api/v1/auth/config').error(new ProgressEvent('error'));
      expect(await result).toBe(false);
      expect(auth.registrationEnabled()).toBeNull();
    });
  });

  describe('login / register / logout', () => {
    it('login() signs in with the returned user (XSRF cookie already present)', async () => {
      setXsrfCookie('abc123');
      const result = firstValueFrom(
        auth.login({ email: 'asha@example.com', password: 'correct horse battery' }),
      );
      const req = httpTesting.expectOne('/api/v1/auth/login');
      expect(req.request.headers.get('X-XSRF-TOKEN')).toBe('abc123');
      req.flush(ME_TWO_WORKSPACES);
      await result;

      expect(auth.status()).toBe('authenticated');
      expect(auth.user()?.email).toBe('asha@example.com');
    });

    it('login() fetches the XSRF cookie first when there is none', async () => {
      const result = firstValueFrom(
        auth.login({ email: 'asha@example.com', password: 'correct horse battery' }),
      );
      httpTesting.expectNone('/api/v1/auth/login');
      httpTesting
        .expectOne('/api/v1/auth/csrf')
        .flush(null, { status: 204, statusText: 'No Content' });

      httpTesting.expectOne('/api/v1/auth/login').flush(ME_TWO_WORKSPACES);
      await result;
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('a failed login leaves the state anonymous', async () => {
      setXsrfCookie();
      auth.clear();
      const result = firstValueFrom(
        auth.login({ email: 'asha@example.com', password: 'wrong password!!' }),
      );
      httpTesting
        .expectOne('/api/v1/auth/login')
        .flush(errorBody('UNAUTHORIZED', 'Invalid email or password.'), {
          status: 401,
          statusText: 'Unauthorized',
        });
      await expect(result).rejects.toMatchObject({ message: 'Invalid email or password.' });
      expect(auth.status()).toBe('anonymous');
    });

    it('register() signs in as the new user', async () => {
      setXsrfCookie();
      const result = firstValueFrom(
        auth.register({ email: 'asha@example.com', password: 'correct horse battery' }),
      );
      httpTesting
        .expectOne('/api/v1/auth/register')
        .flush(ME_TWO_WORKSPACES, { status: 201, statusText: 'Created' });
      await result;
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('logout() clears the state and stored workspace only after the server confirmed', async () => {
      setXsrfCookie();
      auth.setSession(ME_TWO_WORKSPACES);
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');

      const failed = firstValueFrom(auth.logout());
      httpTesting.expectOne('/api/v1/auth/logout').error(new ProgressEvent('error'));
      await expect(failed).rejects.toBeTruthy();
      expect(auth.isAuthenticated()).toBe(true);
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');

      const done = firstValueFrom(auth.logout());
      httpTesting
        .expectOne('/api/v1/auth/logout')
        .flush(null, { status: 204, statusText: 'No Content' });
      await done;
      expect(auth.status()).toBe('anonymous');
      expect(auth.user()).toBeNull();
      expect(auth.workspaces()).toEqual([]);
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
    });
  });

  describe('expireSession (a 401 while the app is in use)', () => {
    it('signs out, forgets the stored workspace and remembers that the session ended', () => {
      auth.setSession(ME_TWO_WORKSPACES);
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');
      expect(auth.sessionExpired()).toBe(false);

      auth.expireSession();

      expect(auth.status()).toBe('anonymous');
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
      expect(auth.sessionExpired()).toBe(true);
    });

    it('does not claim a session ended when nobody was signed in', () => {
      auth.clear();
      auth.expireSession();
      expect(auth.sessionExpired()).toBe(false);
    });

    it('forgets the notice once someone signs in again', () => {
      auth.setSession(ME_TWO_WORKSPACES);
      auth.expireSession();
      auth.setSession(ME_TWO_WORKSPACES);
      expect(auth.sessionExpired()).toBe(false);
    });
  });

  it('renameWorkspace() renames the cached membership and keeps name order', () => {
    auth.setSession(ME_TWO_WORKSPACES);
    auth.renameWorkspace('10', 'Zeta Fabrics');
    expect(auth.workspaces().map((w) => [w.id, w.name])).toEqual([
      ['20', 'Bharat Traders'],
      ['10', 'Zeta Fabrics'],
    ]);
  });
});
