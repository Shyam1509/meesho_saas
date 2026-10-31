import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_OWNER,
  ME_TWO_WORKSPACES,
  clearXsrfCookie,
  setXsrfCookie,
  textOf,
} from '../../../testing/test-data';
import { routes } from '../../app.routes';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { SELECTED_WORKSPACE_STORAGE_KEY } from '../../core/workspaces/workspace-context.service';
import { Shell } from './shell';

const EXPECTED_NAV = [
  ['Overview', '/overview'],
  ['Orders', '/orders'],
  ['Settlements & reconciliation', '/settlements'],
  ['Products & costs', '/products'],
  ['Expenses', '/expenses'],
  ['Imports', '/imports'],
  ['Reports', '/reports'],
  ['Seller accounts', '/seller-accounts'],
  ['Workspace settings', '/settings'],
];

describe('Shell', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;
  let auth: AuthStateService;

  // The shell is the top-level routed component for every signed-in page.
  const host = () => harness.routeNativeElement as HTMLElement;
  const header = () => host().querySelector('header') as HTMLElement;
  const nav = () => host().querySelector('nav') as HTMLElement;
  const navLinks = () => Array.from(nav().querySelectorAll('a'));
  const menuButton = () => host().querySelector('header button') as HTMLButtonElement;
  const switcher = () => host().querySelector('#workspace-switcher') as HTMLSelectElement | null;
  const signOutButton = () =>
    Array.from(header().querySelectorAll('button')).find((b) =>
      textOf(b).startsWith('Sign'),
    ) as HTMLButtonElement;
  const detectChanges = () => harness.fixture.detectChanges();

  // Starts on a page that calls no API (Orders, Settlements and Imports load seller accounts), so
  // these tests see only the shell's own requests.
  async function createHarness(me: MeResponse = ME_TWO_WORKSPACES): Promise<void> {
    auth.setSession(me);
    harness = await RouterTestingHarness.create('/products');
  }

  beforeEach(() => {
    localStorage.clear();
    setXsrfCookie();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStateService);
  });

  afterEach(() => {
    httpTesting.verify();
    clearXsrfCookie();
    localStorage.clear();
  });

  describe('layout and navigation', () => {
    beforeEach(() => createHarness());

    it('shows the product name in the header', () => {
      expect(host().tagName.toLowerCase()).toBe('app-shell');
      expect(header().textContent).toContain('Meesho Seller SaaS');
    });

    it('renders the 9 primary nav links with accessible names', () => {
      expect(nav().getAttribute('aria-label')).toBe('Main');

      const links = navLinks().map((a) => [
        a.getAttribute('aria-label') ?? a.textContent?.trim(),
        a.getAttribute('href'),
      ]);
      expect(links).toEqual(EXPECTED_NAV);
    });

    it('has a route (with the same page title) under the shell for every nav link', () => {
      const shellRoute = routes.find((r) => r.component === Shell);
      for (const [label, link] of EXPECTED_NAV) {
        const route = shellRoute?.children?.find((r) => `/${r.path}` === link);
        expect(route?.title, link).toBe(label);
      }
    });

    it('menu button toggles aria-expanded and controls the nav', () => {
      expect(menuButton().textContent?.trim()).toBe('Menu');
      expect(menuButton().getAttribute('aria-controls')).toBe(nav().id);
      expect(menuButton().getAttribute('aria-expanded')).toBe('false');
      expect(nav().classList).toContain('hidden');

      menuButton().click();
      detectChanges();
      expect(menuButton().getAttribute('aria-expanded')).toBe('true');
      expect(nav().classList).not.toContain('hidden');

      menuButton().click();
      detectChanges();
      expect(menuButton().getAttribute('aria-expanded')).toBe('false');
      expect(nav().classList).toContain('hidden');
    });

    it('Escape closes the open menu and returns focus to the menu button', () => {
      menuButton().click();
      detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      detectChanges();

      expect(menuButton().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(menuButton());
    });

    it('skip link moves focus to the main content', () => {
      const skipLink = host().querySelector('a[href="#main-content"]') as HTMLAnchorElement;
      expect(skipLink.textContent?.trim()).toBe('Skip to main content');

      skipLink.click();

      expect(document.activeElement).toBe(host().querySelector('main#main-content'));
    });

    it('marks only the active link with aria-current="page"', async () => {
      await harness.navigateByUrl('/reports');
      detectChanges();

      const current = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.trim())).toEqual(['Reports']);
    });

    it('keeps "Orders" current on an order’s page (/accounts/:accountId/orders/:orderId)', async () => {
      await harness.navigateByUrl('/accounts/100/orders/9001');
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/9001')
        .flush(null, { status: 404, statusText: 'Not Found' });
      await harness.fixture.whenStable();

      const current = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.trim())).toEqual(['Orders']);
      expect(navLinks().find((a) => a.textContent?.trim() === 'Orders')?.classList).toContain(
        'is-active',
      );

      await harness.navigateByUrl('/settlements?tab=reconciliation');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [] });
      await harness.fixture.whenStable();
      const nowCurrent = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
      expect(nowCurrent.map((a) => a.textContent?.trim())).toEqual([
        'Settlements & reconciliation',
      ]);
    });
  });

  describe('user and workspace', () => {
    it('shows the user, their role in the selected workspace and a workspace switcher', async () => {
      await createHarness(ME_TWO_WORKSPACES);

      expect(header().textContent).toContain('Asha Rao');
      expect(header().textContent).toContain('asha@example.com');
      expect(textOf(header())).toContain('Your role: Owner');
      expect(textOf(host().querySelector('label[for="workspace-switcher"]'))).toBe('Workspace');
      const options = Array.from(switcher()?.options ?? []).map((o) => [o.value, textOf(o)]);
      expect(options).toEqual([
        ['10', 'Asha Textiles'],
        ['20', 'Bharat Traders'],
      ]);
      expect(switcher()?.value).toBe('10');
    });

    it('switching workspace updates the role and remembers the choice', async () => {
      await createHarness(ME_TWO_WORKSPACES);

      const select = switcher() as HTMLSelectElement;
      select.value = '20';
      select.dispatchEvent(new Event('change'));
      await harness.fixture.whenStable();

      expect(textOf(header())).toContain('Your role: Member');
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');
    });

    it('shows the workspace name instead of a switcher with one workspace, email as the name', async () => {
      await createHarness(ME_OWNER);

      expect(switcher()).toBeNull();
      expect(textOf(header())).toContain('Workspace: Asha Textiles');
      expect(textOf(header())).toContain('asha@example.com');
      expect(textOf(header())).toContain('Your role: Owner');
    });
  });

  describe('sign out', () => {
    beforeEach(() => createHarness());

    it('POSTs /auth/logout, forgets the stored workspace, then shows the sign-in page', async () => {
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');
      signOutButton().click();
      detectChanges();
      expect(signOutButton().getAttribute('aria-disabled')).toBe('true');

      httpTesting
        .expectOne({ method: 'POST', url: '/api/v1/auth/logout' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await vi.waitFor(() =>
        httpTesting.expectOne('/api/v1/auth/config').flush({ registrationEnabled: false }),
      );
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/login'));
      expect(auth.status()).toBe('anonymous');
      expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
    });

    it('stays signed in and explains when the server could not sign out', async () => {
      signOutButton().click();
      httpTesting.expectOne('/api/v1/auth/logout').error(new ProgressEvent('error'));
      await harness.fixture.whenStable();

      expect(textOf(host().querySelector('[role="alert"]'))).toBe(
        'Sign-out failed: Could not reach the server. Check your connection and try again.',
      );
      expect(auth.isAuthenticated()).toBe(true);
      expect(TestBed.inject(Router).url).toBe('/products');
    });
  });
});
