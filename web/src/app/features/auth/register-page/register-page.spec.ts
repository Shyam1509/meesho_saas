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
import { RegisterPage } from './register-page';

@Component({ template: '' })
class Blank {}

const GOOD_PASSWORD = 'correct horse battery';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let httpTesting: HttpTestingController;
  let router: Router;

  const host = () => fixture.nativeElement as HTMLElement;
  const input = (id: string) => host().querySelector(`#register-${id}`) as HTMLInputElement;
  const errorText = (id: string) => textOf(host().querySelector(`#register-${id}-error`));
  const submitButton = () => host().querySelector('button[type="submit"]') as HTMLButtonElement;
  const alert = () => host().querySelector('[role="alert"]') as HTMLElement | null;

  async function submit(): Promise<void> {
    submitButton().click();
    await fixture.whenStable();
  }

  function fillRequired(email = 'asha@example.com', password = GOOD_PASSWORD): void {
    typeInto(input('email'), email);
    typeInto(input('password'), password);
    typeInto(input('confirm-password'), password);
  }

  beforeEach(async () => {
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
    fixture = TestBed.createComponent(RegisterPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
  });

  it('renders labelled fields, marking the optional ones', () => {
    expect(textOf(host().querySelector('h1'))).toBe('Create an account');
    expect(textOf(host().querySelector('label[for="register-display-name"]'))).toBe(
      'Your name (optional)',
    );
    expect(textOf(host().querySelector('label[for="register-workspace-name"]'))).toBe(
      'Workspace name (optional)',
    );
    expect(input('password').getAttribute('autocomplete')).toBe('new-password');
    expect(input('password').getAttribute('aria-describedby')).toBe('register-password-hint');
    expect(textOf(host().querySelector('#register-password-hint'))).toContain(
      '12 to 128 characters.',
    );
  });

  describe('client validation', () => {
    it('blocks an empty submit and focuses the first invalid field (email)', async () => {
      await submit();

      httpTesting.expectNone('/api/v1/auth/register');
      expect(host().querySelector('#register-display-name-error')).toBeNull();
      expect(errorText('email')).toBe('Enter your email address.');
      expect(errorText('password')).toBe('Choose a password.');
      expect(errorText('confirm-password')).toBe('Enter the password again.');
      expect(document.activeElement).toBe(input('email'));
    });

    it('requires 12–128 characters and a matching confirmation', async () => {
      typeInto(input('email'), 'asha@example.com');
      typeInto(input('password'), 'eleven char');
      typeInto(input('confirm-password'), 'something else');
      await submit();

      httpTesting.expectNone('/api/v1/auth/register');
      expect(errorText('password')).toBe('Password must be at least 12 characters.');
      expect(errorText('confirm-password')).toBe('The passwords do not match.');
      expect(document.activeElement).toBe(input('password'));

      // Changing the password re-checks the confirmation.
      typeInto(input('password'), 'something else');
      await fixture.whenStable();
      expect(host().querySelector('#register-password-error')).toBeNull();
      expect(host().querySelector('#register-confirm-password-error')).toBeNull();
    });

    it('limits the optional names to 120 characters', async () => {
      fillRequired();
      typeInto(input('display-name'), 'n'.repeat(121));
      typeInto(input('workspace-name'), 'w'.repeat(121));
      await submit();

      httpTesting.expectNone('/api/v1/auth/register');
      expect(errorText('display-name')).toBe('Your name must be at most 120 characters.');
      expect(errorText('workspace-name')).toBe('Workspace name must be at most 120 characters.');
      expect(document.activeElement).toBe(input('display-name'));
    });
  });

  it('sends trimmed values, leaves blank optional fields out and signs in', async () => {
    fillRequired(' asha@example.com ');
    typeInto(input('display-name'), '   ');
    await submit();

    const req = httpTesting.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'asha@example.com', password: GOOD_PASSWORD });
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');

    req.flush(ME_OWNER, { status: 201, statusText: 'Created' });
    await vi.waitFor(() => expect(router.url).toBe('/overview'));
    expect(TestBed.inject(AuthStateService).isAuthenticated()).toBe(true);
  });

  it('sends the optional names when given and honours a safe returnUrl', async () => {
    fixture.componentRef.setInput('returnUrl', '/settings');
    fillRequired();
    typeInto(input('display-name'), ' Asha Rao ');
    typeInto(input('workspace-name'), 'Asha Textiles');
    await submit();

    const req = httpTesting.expectOne('/api/v1/auth/register');
    expect(req.request.body).toEqual({
      email: 'asha@example.com',
      password: GOOD_PASSWORD,
      displayName: 'Asha Rao',
      workspaceName: 'Asha Textiles',
    });
    req.flush(ME_OWNER, { status: 201, statusText: 'Created' });
    await vi.waitFor(() => expect(router.url).toBe('/settings'));
  });

  it.each([
    [403, 'FORBIDDEN', 'Registration is disabled.'],
    [409, 'CONFLICT', 'An account with this email already exists.'],
    [429, 'RATE_LIMITED', 'Too many attempts. Try again later.'],
  ])('shows the server message for %i and focuses it', async (status, code, message) => {
    fillRequired();
    await submit();

    httpTesting
      .expectOne('/api/v1/auth/register')
      .flush(errorBody(code, message), { status, statusText: 'Error' });
    await fixture.whenStable();

    expect(textOf(alert())).toBe(message);
    expect(document.activeElement).toBe(alert());
    expect(router.url).toBe('/');
  });

  it('puts 400 field details under the matching field', async () => {
    fillRequired();
    await submit();

    httpTesting
      .expectOne('/api/v1/auth/register')
      .flush(
        errorBody('VALIDATION_ERROR', 'Validation failed', [
          { field: 'email', reasons: ['email must be an email'] },
        ]),
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();

    expect(textOf(alert())).toBe('Validation failed');
    expect(errorText('email')).toBe('email must be an email');
    expect(input('email').getAttribute('aria-invalid')).toBe('true');
  });
});
