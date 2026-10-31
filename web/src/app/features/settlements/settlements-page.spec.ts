import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_OWNER,
  paged,
  reconciliationOverview,
  sellerAccount,
  settlementList,
  textOf,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { SettlementsPage } from './settlements-page';

@Component({ template: 'stub' })
class Stub {}

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet' });

describe('SettlementsPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const tabs = () => Array.from(host().querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
  const tab = (label: string) => tabs().find((t) => textOf(t) === label) as HTMLButtonElement;
  const panel = () => host().querySelector('[role="tabpanel"]') as HTMLElement;

  function flushEntries(accountId = '100'): void {
    httpTesting
      .expectOne((r) => r.url === `/api/v1/accounts/${accountId}/settlements`)
      .flush(settlementList([]));
  }

  function flushReconciliation(accountId = '100'): void {
    const base = `/api/v1/accounts/${accountId}/reconciliation`;
    httpTesting.expectOne(base).flush(reconciliationOverview());
    httpTesting.expectOne(`${base}/unmatched-settlements?page=1&pageSize=25`).flush(paged([]));
    httpTesting.expectOne(`${base}/orders-without-settlement?page=1&pageSize=25`).flush(paged([]));
    httpTesting.expectOne(`${base}/runs?page=1&pageSize=10`).flush(paged([]));
  }

  async function render(start = '/settlements'): Promise<void> {
    TestBed.inject(AuthStateService).setSession(ME_OWNER);
    harness = await RouterTestingHarness.create(start);
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN, OUTLET] });
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'settlements', component: SettlementsPage },
            { path: 'imports', component: Stub },
          ],
          withComponentInputBinding(),
        ),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('explains that amounts are as reported, not profit, and not tax advice', async () => {
    await render();
    flushEntries();
    await stable();
    expect(textOf(host().querySelector('h1'))).toBe('Settlements & reconciliation');
    expect(textOf(host().querySelector('[data-testid="as-reported-note"]'))).toBe(
      'Amounts are as reported by Meesho — not profit. TCS and TDS are shown separately and are not tax advice.',
    );
  });

  it('renders an accessible tab list with Entries selected by default', async () => {
    await render();
    flushEntries();
    await stable();

    const tablist = host().querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist.getAttribute('aria-label')).toBe('Settlements views');
    expect(tabs().map((t) => textOf(t))).toEqual(['Entries', 'Reconciliation']);
    expect(tab('Entries').getAttribute('aria-selected')).toBe('true');
    expect(tab('Entries').getAttribute('tabindex')).toBe('0');
    expect(tab('Entries').getAttribute('aria-controls')).toBe('settlements-panel-entries');
    expect(tab('Reconciliation').getAttribute('aria-selected')).toBe('false');
    expect(tab('Reconciliation').getAttribute('tabindex')).toBe('-1');
    expect(panel().id).toBe('settlements-panel-entries');
    expect(panel().getAttribute('aria-labelledby')).toBe('settlements-tab-entries');
    // Focusable, so its keyboard focus must be visible (WCAG 2.4.7).
    expect(panel().getAttribute('tabindex')).toBe('0');
    expect(panel().className).toContain('focus-visible:outline-2');
    expect(panel().className).not.toContain('outline-none');
    expect(panel().querySelector('app-settlement-entries-tab')).not.toBeNull();
  });

  it('puts the selected tab in the URL and keeps the other query params', async () => {
    await render('/settlements?q=TXN');
    flushEntries();
    await stable();

    tab('Reconciliation').click();
    await stable();
    expect(url()).toBe('/settlements?q=TXN&tab=reconciliation');
    flushReconciliation();
    await stable();
    expect(tab('Reconciliation').getAttribute('aria-selected')).toBe('true');
    expect(panel().id).toBe('settlements-panel-reconciliation');
    expect(panel().querySelector('app-reconciliation-tab')).not.toBeNull();

    tab('Entries').click();
    await stable();
    expect(url()).toBe('/settlements?q=TXN');
    flushEntries();
    await stable();
  });

  it('opens the tab named in the URL, and Entries for an unknown one', async () => {
    await render('/settlements?tab=reconciliation');
    flushReconciliation();
    await stable();
    expect(tab('Reconciliation').getAttribute('aria-selected')).toBe('true');

    await harness.navigateByUrl('/settlements?tab=nope');
    flushEntries();
    await stable();
    expect(tab('Entries').getAttribute('aria-selected')).toBe('true');
  });

  it('moves between tabs with the arrow keys, Home and End, keeping focus on the tabs', async () => {
    await render();
    flushEntries();
    await stable();

    tab('Entries').focus();
    tab('Entries').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await stable();
    expect(url()).toBe('/settlements?tab=reconciliation');
    expect(document.activeElement).toBe(tab('Reconciliation'));
    flushReconciliation();
    await stable();

    tab('Reconciliation').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await stable();
    expect(url()).toBe('/settlements');
    expect(document.activeElement).toBe(tab('Entries'));
    flushEntries();
    await stable();

    tab('Entries').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await stable();
    expect(url()).toBe('/settlements?tab=reconciliation');
    flushReconciliation();
    await stable();

    tab('Reconciliation').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await stable();
    expect(url()).toBe('/settlements');
    flushEntries();
    await stable();
  });

  it('another account starts at its first page, without a request for the old page', async () => {
    await render('/settlements?page=3&match=matched');
    const first = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/settlements');
    expect(first.request.params.get('page')).toBe('3');
    first.flush(settlementList([], { settlementAmount: null, count: 0 }, 3, 60));
    await stable();

    const select = host().querySelector('#settlements-account') as HTMLSelectElement;
    select.value = '101';
    select.dispatchEvent(new Event('change'));
    await stable();

    expect(url()).toBe('/settlements?match=matched');
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/101/settlements');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('match')).toBe('matched');
    req.flush(settlementList([]));
    await stable();
  });
});
