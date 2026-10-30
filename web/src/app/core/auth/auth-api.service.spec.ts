import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ME_OWNER, errorBody } from '../../../testing/test-data';
import { ApiError } from '../api/api-error';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { AuthApiService } from './auth-api.service';

describe('AuthApiService', () => {
  let service: AuthApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('config() GETs /auth/config', async () => {
    const result = firstValueFrom(service.config());
    const req = httpTesting.expectOne('/api/v1/auth/config');
    expect(req.request.method).toBe('GET');
    req.flush({ registrationEnabled: true });
    expect(await result).toEqual({ registrationEnabled: true });
  });

  it('csrf() GETs /auth/csrf and completes on 204', async () => {
    const result = firstValueFrom(service.csrf());
    const req = httpTesting.expectOne('/api/v1/auth/csrf');
    expect(req.request.method).toBe('GET');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeUndefined();
  });

  it('me() GETs /auth/me and maps a 401 to an ApiError', async () => {
    const ok = firstValueFrom(service.me());
    httpTesting.expectOne({ method: 'GET', url: '/api/v1/auth/me' }).flush(ME_OWNER);
    expect(await ok).toEqual(ME_OWNER);

    const denied = firstValueFrom(service.me());
    httpTesting
      .expectOne('/api/v1/auth/me')
      .flush(errorBody('UNAUTHORIZED', 'Authentication required.'), {
        status: 401,
        statusText: 'Unauthorized',
      });
    await expect(denied).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  });

  it('login() POSTs the credentials to /auth/login', async () => {
    const result = firstValueFrom(
      service.login({ email: 'asha@example.com', password: 'correct horse battery' }),
    );
    const req = httpTesting.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'asha@example.com',
      password: 'correct horse battery',
    });
    req.flush(ME_OWNER);
    expect(await result).toEqual(ME_OWNER);
  });

  it('register() POSTs the body to /auth/register', async () => {
    const body = {
      email: 'asha@example.com',
      password: 'correct horse battery',
      displayName: 'Asha',
      workspaceName: 'Asha Textiles',
    };
    const result = firstValueFrom(service.register(body));
    const req = httpTesting.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(ME_OWNER, { status: 201, statusText: 'Created' });
    expect(await result).toEqual(ME_OWNER);
  });

  it('register() maps a 409 envelope to an ApiError', async () => {
    const result = firstValueFrom(
      service.register({ email: 'asha@example.com', password: 'correct horse battery' }),
    );
    httpTesting
      .expectOne('/api/v1/auth/register')
      .flush(errorBody('CONFLICT', 'An account with this email already exists.'), {
        status: 409,
        statusText: 'Conflict',
      });
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it('logout() POSTs to /auth/logout without a body and completes on 204', async () => {
    const result = firstValueFrom(service.logout());
    const req = httpTesting.expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeUndefined();
  });
});
