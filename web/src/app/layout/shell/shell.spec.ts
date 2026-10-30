import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from '../../app.routes';
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
  let fixture: ComponentFixture<Shell>;

  const host = () => fixture.nativeElement as HTMLElement;
  const nav = () => host().querySelector('nav') as HTMLElement;
  const navLinks = () => Array.from(nav().querySelectorAll('a'));
  const menuButton = () => host().querySelector('header button') as HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
      ],
    });
    fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
  });

  it('shows the product name in the header', () => {
    expect(host().querySelector('header')?.textContent).toContain('Meesho Seller SaaS');
  });

  it('renders the 9 primary nav links with accessible names', () => {
    expect(nav().getAttribute('aria-label')).toBe('Main');

    const links = navLinks().map((a) => [
      a.getAttribute('aria-label') ?? a.textContent?.trim(),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual(EXPECTED_NAV);
  });

  it('has a route (with the same page title) for every nav link', () => {
    for (const [label, link] of EXPECTED_NAV) {
      const route = routes.find((r) => `/${r.path}` === link);
      expect(route?.title, link).toBe(label);
    }
  });

  it('menu button toggles aria-expanded and controls the nav', () => {
    expect(menuButton().textContent?.trim()).toBe('Menu');
    expect(menuButton().getAttribute('aria-controls')).toBe(nav().id);
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(nav().classList).toContain('hidden');

    menuButton().click();
    fixture.detectChanges();
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(nav().classList).not.toContain('hidden');

    menuButton().click();
    fixture.detectChanges();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(nav().classList).toContain('hidden');
  });

  it('Escape closes the open menu and returns focus to the menu button', () => {
    menuButton().click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

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
    await TestBed.inject(Router).navigateByUrl('/orders');
    await fixture.whenStable();
    fixture.detectChanges();

    const current = navLinks().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Orders']);
  });
});
