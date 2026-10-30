import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';

import { ME_OWNER, importDetail } from '../testing/test-data';
import { App } from './app';
import { routes } from './app.routes';
import { provideApiHttpClient } from './core/api/provide-api-http-client';
import { AuthStateService } from './core/auth/auth-state.service';
import { AppTitleStrategy } from './core/title/app-title-strategy';

describe('App', () => {
  let httpTesting: HttpTestingController;
  let auth: AuthStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideApiHttpClient(),
        provideHttpClientTesting(),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStateService);
  });

  afterEach(() => httpTesting.verify());

  it('renders the app shell for a signed-in user', async () => {
    auth.setSession(ME_OWNER);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/orders');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-shell header')?.textContent).toContain('Meesho Seller SaaS');
    expect(el.querySelector('main#main-content')).not.toBeNull();
  });

  it('shows the sign-in page, without the shell, to a signed-out visitor', async () => {
    auth.clear();
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled: true });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(router.url).toBe('/login?returnUrl=%2Foverview');
    expect(el.querySelector('app-shell')).toBeNull();
    expect(el.querySelector('app-login-page h1')?.textContent?.trim()).toBe('Sign in');
    expect(document.title).toBe('Sign in · Meesho Seller SaaS');
  });

  it.each([
    ['/seller-accounts', 'Seller accounts', '/api/v1/workspaces/10/accounts'],
    ['/settings', 'Workspace settings', '/api/v1/workspaces/10/members'],
  ])('%s shows the "%s" page inside the shell', async (url, heading, request) => {
    auth.setSession(ME_OWNER);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    httpTesting.expectOne(request).flush({ items: [] });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-shell main h1')?.textContent?.trim()).toBe(heading);
    expect(document.title).toBe(`${heading} · Meesho Seller SaaS`);
  });

  it('/imports shows the "Imports" page inside the shell', async () => {
    auth.setSession(ME_OWNER);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/imports');
    await fixture.whenStable();
    httpTesting.expectOne('/api/v1/imports/config').flush({ maxFileMb: 10, maxRows: 50000 });
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [] });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-shell main h1')?.textContent?.trim()).toBe('Imports');
    expect(document.title).toBe('Imports · Meesho Seller SaaS');
  });

  it('/imports/:importId shows that import inside the shell, titled "Import details"', async () => {
    auth.setSession(ME_OWNER);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/imports/500');
    await fixture.whenStable();
    expect(document.title).toBe('Import details · Meesho Seller SaaS');

    httpTesting.expectOne('/api/v1/imports/500').flush(importDetail({ errorRows: 0 }));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-shell main h1')?.textContent?.trim()).toBe('orders-oct.csv');
    expect(
      el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.textContent?.trim(),
    ).toBe('Imports');
  });
});
