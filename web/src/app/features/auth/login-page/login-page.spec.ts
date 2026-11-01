import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import {
  ME_OWNER,
  clearXsrfCookie,
  errorBody,
  setXsrfCookie,
  textOf,
  typeInto,
} from '../../../../testing/test-data';
import { provideApiHttpClient } from '../../../core/api/provide-api-http-client';
import { AuthStateService } from '../../../core/auth/auth-state.service';
import { LoginPage } from './login-page';

@Component({ template: '' })
class Blank {}

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let httpTesting: HttpTestingController;
  let router: Router;

  const host = () => fixture.nativeElement as HTMLElement;
  const emailInput = () => host().querySelector('#login-email') as HTMLInputElement;
  const passwordInput = () => host().querySelector('#login-password') as HTMLInputElement;
  const submitButton = () => host().querySelector('button[type="submit"]') as HTMLButtonElement;
  const alert = () => host().querySelector('[role="alert"]') as HTMLElement | null;
  const registerLink = () => host().querySelector('a[href^="/register"]');

  async function render(registrationEnabled = true): Promise<void> {
    fixture = TestBed.createComponent(LoginPage);
    httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled });
    await fixture.whenStable();
  }

  async function fillAndSubmit(email: string, password: string): Promise<void> {
    typeInto(emailInput(), email);
    typeInto(passwordInput(), password);
    submitButton().click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    setXsrfCookie();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(AuthStateService).clear();
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
  });

  it('renders a labelled sign-in form', async () => {
    await render();
    expect(textOf(host().querySelector('h1'))).toBe('Sign in');
    expect(textOf(host().querySelector('label[for="login-email"]'))).toBe('Email');
    expect(textOf(host().querySelector('label[for="login-password"]'))).toBe('Password');
    expect(emailInput().getAttribute('autocomplete')).toBe('username');
    expect(passwordInput().type).toBe('password');
    expect(passwordInput().getAttribute('autocomplete')).toBe('current-password');
  });

  it('links to registration when the API allows it, keeping a safe returnUrl', async () => {
    await render(true);
    fixture.componentRef.setInput('returnUrl', '/orders');
    await fixture.whenStable();
    expect(textOf(registerLink())).toBe('Create an account');
    expect(registerLink()?.getAttribute('href')).toBe('/register?returnUrl=%2Forders');
  });

  it('does not link to registration when the API disallows it', async () => {
    await render(false);
    expect(registerLink()).toBeNull();
  });

  describe('client validation', () => {
    it('blocks an empty submit, explains both fields and focuses the first', async () => {
      await render();
      submitButton().click();
      await fixture.whenStable();

      httpTesting.expectNone('/api/v1/auth/login');
      expect(textOf(host().querySelector('#login-email-error'))).toBe('Enter your email address.');
      expect(textOf(host().querySelector('#login-password-error'))).toBe('Enter your password.');
      expect(emailInput().getAttribute('aria-invalid')).toBe('true');
      expect(emailInput().getAttribute('aria-describedby')).toBe('login-email-error');
      expect(document.activeElement).toBe(emailInput());
    });

    it('checks the email format (ASCII only) and caps the password at 128', async () => {
      await render();
      await fillAndSubmit('not-an-email', 'x'.repeat(129));

      httpTesting.expectNone('/api/v1/auth/login');
      expect(textOf(host().querySelector('#login-email-error'))).toBe(
        'Enter a valid email address, like name@example.com.',
      );
      expect(textOf(host().querySelector('#login-password-error'))).toBe(
        'Password must be at most 128 characters.',
      );

      // A lookalike address with a Cyrillic "a" (U+0430) is rejected before it reaches the API.
      await fillAndSubmit('\u0430sha@example.com', 'correct horse battery');
      httpTesting.expectNone('/api/v1/auth/login');
      expect(textOf(host().querySelector('#login-email-error'))).toBe(
        'Enter a valid email address, like name@example.com.',
      );
      expect(document.activeElement).toBe(emailInput());
    });

    it('does not apply the 12-character sign-up minimum to sign-in', async () => {
      await render();
      await fillAndSubmit('asha@example.com', 'short');

      expect(host().querySelector('#login-password-error')).toBeNull();
      const req = httpTesting.expectOne('/api/v1/auth/login');
      expect(req.request.body).toEqual({ email: 'asha@example.com', password: 'short' });
      req.flush(ME_OWNER);
      await vi.waitFor(() => expect(router.url).toBe('/overview'));
    });
  });

  it('signs in, disables submit while pending and goes to a safe returnUrl', async () => {
    await render();
    fixture.componentRef.setInput('returnUrl', '/seller-accounts');
    await fillAndSubmit('  Asha@Example.com ', 'correct horse battery');

    const req = httpTesting.expectOne('/api/v1/auth/login');
    expect(req.request.body).toEqual({
      email: 'Asha@Example.com',
      password: 'correct horse battery',
    });
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    expect(textOf(submitButton())).toBe('Signing in…');

    // A second submit while pending sends nothing.
    submitButton().click();
    httpTesting.expectNone('/api/v1/auth/login');

    req.flush(ME_OWNER);
    await vi.waitFor(() => expect(router.url).toBe('/seller-accounts'));
    expect(TestBed.inject(AuthStateService).isAuthenticated()).toBe(true);
  });

  it.each([['https://evil.example/phish'], ['//evil.example'], ['/\\evil.example']])(
    'ignores the unsafe returnUrl %s and goes to /overview',
    async (returnUrl) => {
      await render();
      fixture.componentRef.setInput('returnUrl', returnUrl);
      await fillAndSubmit('asha@example.com', 'correct horse battery');

      httpTesting.expectOne('/api/v1/auth/login').flush(ME_OWNER);
      await vi.waitFor(() => expect(router.url).toBe('/overview'));
    },
  );

  describe('server errors', () => {
    it.each([
      [401, 'UNAUTHORIZED', 'Invalid email or password.'],
      [403, 'FORBIDDEN', 'Request blocked. Reload the page and try again.'],
      [409, 'CONFLICT', 'The request could not be completed.'],
      [429, 'RATE_LIMITED', 'Too many attempts. Try again later.'],
    ])('shows the server message for %i and focuses it', async (status, code, message) => {
      await render();
      await fillAndSubmit('asha@example.com', 'correct horse battery');

      httpTesting
        .expectOne('/api/v1/auth/login')
        .flush(errorBody(code, message), { status, statusText: 'Error' });
      await fixture.whenStable();

      expect(textOf(alert())).toBe(message);
      expect(document.activeElement).toBe(alert());
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
      expect(router.url).toBe('/');
    });

    it('explains a network failure', async () => {
      await render();
      await fillAndSubmit('asha@example.com', 'correct horse battery');
      httpTesting.expectOne('/api/v1/auth/login').error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(textOf(alert())).toBe(
        "Can't reach the server. Check your connection and try again.",
      );
    });
  });

  describe('after the session ended while the app was in use', () => {
    const notice = () => host().querySelector('[data-testid="session-expired"]');

    beforeEach(() => {
      const auth = TestBed.inject(AuthStateService);
      auth.setSession(ME_OWNER);
      auth.expireSession();
    });

    it('says the session ended and that they will be back on their page', async () => {
      await render();
      fixture.componentRef.setInput('returnUrl', '/orders?page=2');
      await fixture.whenStable();

      expect(notice()?.getAttribute('role')).toBe('alert');
      expect(textOf(notice())).toBe(
        'Your session ended. Sign in again to continue — you will be back on the page you were using.',
      );
    });

    it('leaves out the return promise without a (safe) returnUrl', async () => {
      await render();
      fixture.componentRef.setInput('returnUrl', 'https://evil.example');
      await fixture.whenStable();
      expect(textOf(notice())).toBe('Your session ended. Sign in again to continue.');
    });

    it('signing in goes back to the page and forgets the notice', async () => {
      await render();
      fixture.componentRef.setInput('returnUrl', '/orders?page=2');
      await fillAndSubmit('asha@example.com', 'correct horse battery');
      httpTesting.expectOne('/api/v1/auth/login').flush(ME_OWNER);

      await vi.waitFor(() => expect(router.url).toBe('/orders?page=2'));
      expect(TestBed.inject(AuthStateService).sessionExpired()).toBe(false);
      await fixture.whenStable();
      expect(notice()).toBeNull();
    });
  });

  it('shows no session notice on a normal visit', async () => {
    await render();
    expect(host().querySelector('[data-testid="session-expired"]')).toBeNull();
  });

  it('says so when the startup session check could not reach the API', async () => {
    const auth = TestBed.inject(AuthStateService);
    const loading = auth.load();
    httpTesting.expectOne('/api/v1/auth/me').error(new ProgressEvent('error'));
    await loading;

    await render();
    expect(textOf(host().querySelector('[role="status"]'))).toContain(
      'We could not check whether you are already signed in.',
    );
  });
});
