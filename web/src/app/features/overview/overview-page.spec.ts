import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_OWNER,
  accountDashboard,
  errorBody,
  sellerAccount,
  textOf,
  workspaceDashboard,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BASIS_HELP, Dashboard, isCancelledOrReturned } from '../../core/dashboard/dashboard.models';
import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { SellerAccount } from '../../core/seller-accounts/seller-account.models';
import { CLOCK } from '../../core/time/clock';
import { OverviewPage } from './overview-page';

@Component({ template: 'list page' })
class StubPage {}

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet' });
const HEALTH = { status: 'ok', db: 'up', uptimeSeconds: 1, timestamp: '2026-11-01T04:30:00Z' };
// 00:30 on 1 Nov 2026 in India (still 31 Oct in UTC).
const AFTER_IST_MIDNIGHT = new Date('2026-10-31T19:00:00Z');

describe('OverviewPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;
  let now: Date;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const card = (id: string) => host().querySelector(`[data-testid="${id}"]`) as HTMLElement;
  /** Text as seen, without the links' screen-reader descriptions. */
  const visibleText = (el: Element | null | undefined) => {
    if (!el) {
      return '';
    }
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-drill-description]').forEach((d) => d.remove());
    return textOf(copy);
  };
  const kpiValue = (id: string) => visibleText(card(id).querySelector('[data-testid="kpi-value"]'));
  const kpiHref = (id: string) =>
    card(id).querySelector('[data-testid="kpi-value"] a')?.getAttribute('href') ?? null;
  const buttonByText = (text: string) =>
    Array.from(host().querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const select = (selector: string) => host().querySelector(selector) as HTMLSelectElement;
  const input = (selector: string) => host().querySelector(selector) as HTMLInputElement;
  const dashboardEl = () => host().querySelector('[data-testid="dashboard"]') as HTMLElement;
  const statusBox = (label: string) => {
    const lbl = Array.from(host().querySelectorAll('app-checkbox-group label')).find((l) =>
      textOf(l).startsWith(label),
    );
    return host().querySelector(`#${lbl?.getAttribute('for')}`) as HTMLInputElement;
  };

  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }

  function expectDashboard(path: string): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/${path}/dashboard`);
  }

  /**
   * Answers every pending `/orders/statuses` request: account 100 has Delivered 40 and RTO
   * Complete 3, any other account Delivered 5. (All accounts: they follow the dashboard's
   * `accounts`, disabled ones included.)
   */
  function flushStatuses(): void {
    for (const req of httpTesting.match((r) => r.url.endsWith('/orders/statuses'))) {
      if (!req.cancelled) {
        const accountId = req.request.url.split('/')[4];
        req.flush({
          items:
            accountId === '100'
              ? [
                  { status: 'Delivered', count: 40 },
                  { status: 'RTO Complete', count: 3 },
                ]
              : [{ status: 'Delivered', count: 5 }],
        });
      }
    }
  }

  async function flushDashboard(path: string, body: Dashboard): Promise<TestRequest> {
    const req = expectDashboard(path);
    req.flush(body);
    await stable();
    flushStatuses();
    await stable();
    return req;
  }

  /**
   * Opens `start` as the owner of workspace 10 and answers the health check, the seller accounts
   * and (one account) its statuses. The dashboard request stays open.
   */
  async function render(
    start = '/overview',
    accounts: SellerAccount[] = [MAIN, OUTLET],
  ): Promise<void> {
    TestBed.inject(AuthStateService).setSession(ME_OWNER);
    harness = await RouterTestingHarness.create(start);
    await stable();
    httpTesting.expectOne('/api/v1/health').flush(HEALTH);
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: accounts });
    await stable();
    flushStatuses();
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    now = AFTER_IST_MIDNIGHT;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'overview', component: OverviewPage },
            { path: 'orders', component: StubPage },
            { path: 'settlements', component: StubPage },
            { path: 'expenses', component: StubPage },
            { path: 'products', component: StubPage },
          ],
          withComponentInputBinding(),
        ),
        provideApiHttpClient(),
        provideHttpClientTesting(),
        { provide: CLOCK, useValue: () => now },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    flushStatuses();
    httpTesting.verify();
    localStorage.clear();
  });

  describe('filters and the URL', () => {
    it('defaults to every account, the last 30 days ending today in India, by order date', async () => {
      await render();
      const req = expectDashboard('workspaces/10');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/dashboard?from=2026-10-03&to=2026-11-01&basis=order_date',
      );
      req.flush(workspaceDashboard());
      await stable();
      // The status options: every account of the dashboard, disabled "Old shop" (102) too.
      expect(
        httpTesting
          .match((r) => r.url.endsWith('/orders/statuses'))
          .map((r) => {
            r.flush({
              items:
                r.request.url.includes('/100/')
                  ? [
                      { status: 'Delivered', count: 40 },
                      { status: 'RTO Complete', count: 3 },
                    ]
                  : [{ status: 'Delivered', count: 5 }],
            });
            return r.request.url;
          })
          .sort(),
      ).toEqual([
        '/api/v1/accounts/100/orders/statuses',
        '/api/v1/accounts/101/orders/statuses',
        '/api/v1/accounts/102/orders/statuses',
      ]);
      await stable();

      expect(input('#overview-scope-all').checked).toBe(true);
      expect(select('#overview-range').value).toBe('last30');
      expect(textOf(host().querySelector('[data-testid="range-hint"]'))).toBe(
        '3 Oct 2026 – 1 Nov 2026 (India time)',
      );
      expect(input('#overview-basis-order_date').checked).toBe(true);
      expect(buttonByText('Clear filters')).toBeUndefined();
      expect(
        Array.from(host().querySelectorAll('app-checkbox-group label')).map(textOf),
      ).toEqual(['Delivered (50)', 'RTO Complete (3)']);
    });

    it('reads scope, preset, basis, statuses and granularity from the URL; "last month" is October when India is already in November', async () => {
      await render(
        '/overview?scope=account&range=lastMonth&basis=payment_date&status=Delivered&status=RTO%20Complete&granularity=week',
      );
      const req = expectDashboard('accounts/100');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/dashboard?from=2026-10-01&to=2026-10-31&basis=payment_date&status=Delivered&status=RTO%20Complete&granularity=week',
      );
      req.flush(accountDashboard());
      await stable();

      expect(input('#overview-scope-account').checked).toBe(true);
      expect(select('#overview-account').value).toBe('100');
      expect(select('#overview-range').value).toBe('lastMonth');
      expect(input('#overview-basis-payment_date').checked).toBe(true);
      expect(textOf(host().querySelector('app-checkbox-group summary'))).toBe(
        'Order status: 2 selected',
      );
      expect(select('#overview-granularity').value).toBe('week');
    });

    it('"this month" and "last month" just before midnight in India stay in October / September', async () => {
      now = new Date('2026-10-31T18:00:00Z'); // 23:30 on 31 Oct in India
      await render('/overview?range=thisMonth');
      const first = expectDashboard('workspaces/10');
      expect(first.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/dashboard?from=2026-10-01&to=2026-10-31&basis=order_date',
      );
      first.flush(workspaceDashboard());
      await stable();

      setValue(select('#overview-range'), 'lastMonth');
      await stable();
      expect(textOf(host().querySelector('[data-testid="range-hint"]'))).toBe(
        '1 Sept 2026 – 30 Sept 2026 (India time)',
      );
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/overview?range=lastMonth');
      const next = expectDashboard('workspaces/10');
      expect(next.request.params.get('from')).toBe('2026-09-01');
      expect(next.request.params.get('to')).toBe('2026-09-30');
      next.flush(workspaceDashboard());
    });

    it('applies preset, basis and statuses to the URL, then "Clear filters" goes back to the defaults', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());

      setValue(select('#overview-range'), 'thisMonth');
      input('#overview-basis-payment_date').click();
      statusBox('Delivered').click();
      await stable();
      expect(textOf(host().querySelector('[data-testid="range-hint"]'))).toBe(
        '1 Nov 2026 (India time)',
      );
      buttonByText('Apply filters')?.click();
      await stable();

      expect(url()).toBe('/overview?range=thisMonth&basis=payment_date&status=Delivered');
      const req = expectDashboard('workspaces/10');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/dashboard?from=2026-11-01&to=2026-11-01&basis=payment_date&status=Delivered',
      );
      req.flush(workspaceDashboard());
      await stable();

      buttonByText('Clear filters')?.click();
      await stable();
      expect(url()).toBe('/overview');
      await flushDashboard('workspaces/10', workspaceDashboard());
    });

    it('explains what the status filter narrows, per basis', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());
      const hint = () => textOf(host().querySelector('[data-testid="status-hint"]'));
      expect(hint()).toBe(
        'Narrows orders, their settlements and costs; ads, referral, recovery, unmatched entries and expenses still count.',
      );
      expect(
        host().querySelector('app-checkbox-group fieldset')?.getAttribute('aria-describedby'),
      ).toBe('overview-status-hint');

      input('#overview-basis-payment_date').click();
      await stable();
      expect(hint()).toBe('Narrows only the order counts and order value.');
    });

    it('"Refresh" reads the clock again: past midnight in India the preset moves on a day', async () => {
      now = new Date('2026-10-31T18:00:00Z'); // 23:30 on 31 Oct in India
      await render();
      const first = expectDashboard('workspaces/10');
      expect(first.request.params.get('from')).toBe('2026-10-02');
      expect(first.request.params.get('to')).toBe('2026-10-31');
      first.flush(workspaceDashboard());
      await stable();

      // Same day: the same request again.
      buttonByText('Refresh the dashboard')?.click();
      await stable();
      const again = expectDashboard('workspaces/10');
      expect(again.request.params.get('to')).toBe('2026-10-31');
      again.flush(workspaceDashboard());
      await stable();

      now = AFTER_IST_MIDNIGHT; // 00:30 on 1 Nov in India
      buttonByText('Refresh the dashboard')?.click();
      await stable();
      const next = expectDashboard('workspaces/10');
      expect(next.request.params.get('from')).toBe('2026-10-03');
      expect(next.request.params.get('to')).toBe('2026-11-01');
      next.flush(workspaceDashboard());
      await stable();
      expect(textOf(host().querySelector('[data-testid="range-hint"]'))).toBe(
        '3 Oct 2026 – 1 Nov 2026 (India time)',
      );
    });

    it('the basis toggle explains each basis', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());
      const help = () => textOf(host().querySelector('[data-testid="basis-help"]'));
      expect(help()).toBe(BASIS_HELP.order_date);
      expect(input('#overview-basis-order_date').getAttribute('aria-describedby')).toBe(
        'overview-basis-help',
      );

      input('#overview-basis-payment_date').click();
      await stable();
      expect(help()).toBe(BASIS_HELP.payment_date);
      expect(help()).toContain('first matched settlement entry was paid in the range');
    });

    it('a custom range starts from the shown dates, refuses a reversed or too-long range, and applies a valid one', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());

      setValue(select('#overview-range'), 'custom');
      await stable();
      expect(input('#overview-date-from').value).toBe('2026-10-03');
      expect(input('#overview-date-to').value).toBe('2026-11-01');

      setValue(input('#overview-date-from'), '2026-11-05');
      await stable();
      expect(host().querySelector('[data-testid="date-range-error"]')).not.toBeNull();
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/overview');

      setValue(input('#overview-date-from'), '2024-01-01');
      await stable();
      expect(textOf(host().querySelector('[data-testid="custom-range-error"]'))).toBe(
        'A range can be at most 731 days long.',
      );
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/overview');

      setValue(input('#overview-date-from'), '2026-10-10');
      await stable();
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/overview?from=2026-10-10&to=2026-11-01');
      const req = expectDashboard('workspaces/10');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/dashboard?from=2026-10-10&to=2026-11-01&basis=order_date',
      );
      req.flush(workspaceDashboard());
      expect(select('#overview-range').value).toBe('custom');
    });

    it('ignores an invalid or too-long custom range in the URL and uses the default preset', async () => {
      await render('/overview?from=2020-01-01&to=2026-10-31&basis=bogus&granularity=hour');
      const req = expectDashboard('workspaces/10');
      expect(req.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/dashboard?from=2026-10-03&to=2026-11-01&basis=order_date',
      );
      req.flush(workspaceDashboard());
    });

    it('switches scope at once and keeps the filters; the trend grouping goes in the URL', async () => {
      await render('/overview?range=last7');
      await flushDashboard('workspaces/10', workspaceDashboard());

      input('#overview-scope-account').click();
      await stable();
      expect(url()).toBe('/overview?scope=account&range=last7');
      // The picker (already loaded) shows the selected account; no accounts reload.
      expect(select('#overview-account').value).toBe('100');
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/statuses')
        .flush({ items: [{ status: 'Delivered', count: 40 }] });
      const req = expectDashboard('accounts/100');
      expect(req.request.params.get('from')).toBe('2026-10-26');
      req.flush(accountDashboard());
      await stable();
      expect(dashboardEl().getAttribute('data-state')).toBe('ready');

      setValue(select('#overview-granularity'), 'month');
      await stable();
      expect(url()).toBe('/overview?scope=account&range=last7&granularity=month');
      const grouped = expectDashboard('accounts/100');
      expect(grouped.request.params.get('granularity')).toBe('month');
      grouped.flush(accountDashboard());
    });
  });

  describe('key figures', () => {
    it('shows each card with INR amounts, the order-value caveat, the formula and the not-a-payout note; never "profit"', async () => {
      await render('/overview?scope=account');
      await flushDashboard('accounts/100', accountDashboard());

      expect(kpiValue('kpi-orders')).toBe('3');
      expect(textOf(card('kpi-orders').querySelector('[data-testid="kpi-units"]'))).toBe('4 units');
      expect(kpiValue('kpi-order-value')).toBe('₹1,497.00');
      expect(textOf(card('kpi-order-value'))).toContain('Listed price: ₹1,797.00');
      expect(textOf(card('kpi-order-value'))).toContain(
        'whether this is per unit or per order line is not confirmed yet',
      );
      expect(kpiValue('kpi-settlement')).toBe('₹1,180.40');
      expect(textOf(card('kpi-settlement'))).toContain('Not a bank payout.');
      expect(kpiValue('kpi-product-cost')).toBe('₹600.00');
      expect(kpiValue('kpi-expenses')).toBe('₹250.00');
      expect(kpiValue('kpi-contribution')).toBe('₹330.40');
      expect(textOf(card('kpi-contribution').querySelector('h3'))).toBe('Estimated contribution');
      expect(textOf(host().querySelector('[data-testid="contribution-formula"]'))).toBe(
        '= Settlement amount − known product cost − expenses',
      );
      expect(textOf(host().querySelector('[data-testid="contribution-badge"]'))).toBe(
        'Inputs complete',
      );
      expect(host().querySelector('[data-testid="incomplete"]')).toBeNull();
      expect(textOf(host().querySelector('[data-testid="not-payout-note"]'))).toBe(
        'This is not a bank payout and not tax advice.',
      );
      expect(textOf(host())).not.toMatch(/profit/i);
    });

    it('tells a true zero (₹0.00) from no data (—)', async () => {
      await render('/overview?scope=account');
      const base = accountDashboard();
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          orders: { ...base.orders, units: null, orderValueListed: null },
          settlements: { ...base.settlements, amount: '0.00' },
          productCost: { ...base.productCost, known: null, knownExact: null, ordersKnown: 0 },
          expenses: { ...base.expenses, amount: null, count: 0 },
          contribution: { ...base.contribution, amount: '0.00' },
        }),
      );

      expect(kpiValue('kpi-settlement')).toBe('₹0.00');
      expect(kpiValue('kpi-contribution')).toBe('₹0.00');
      expect(kpiValue('kpi-product-cost')).toBe('— no known cost');
      expect(card('kpi-product-cost').querySelector('app-amount')?.getAttribute('data-missing')).toBe(
        'true',
      );
      expect(kpiValue('kpi-expenses')).toBe('— no expenses');
      expect(textOf(card('kpi-orders').querySelector('[data-testid="kpi-units"]'))).toBe('— units');
      expect(textOf(card('kpi-order-value').querySelector('[data-testid="kpi-listed"]'))).toBe(
        '— no price reported',
      );
    });

    it('lists every reason the estimate is incomplete, with counts and links to the filtered lists', async () => {
      await render('/overview?scope=account');
      const base = accountDashboard();
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          orders: { ...base.orders, pricesMissing: 1 },
          productCost: { ...base.productCost, ordersCostUnknown: 1, ordersNoProduct: 1 },
          contribution: {
            ...base.contribution,
            complete: false,
            flags: {
              costUnknown: 2,
              ordersWithoutSettlement: 1,
              unmatchedSettlements: 3,
              pricesMissing: 1,
              cancelledOrReturned: 0,
            },
          },
        }),
      );
      expect(host().querySelector('li[data-flag="cancelledOrReturned"]')).toBeNull();

      expect(textOf(host().querySelector('[data-testid="contribution-badge"]'))).toBe('Incomplete');
      const flag = (key: string) =>
        host().querySelector(`[data-testid="incomplete"] li[data-flag="${key}"]`) as HTMLElement;
      const hrefs = (key: string) =>
        Array.from(flag(key).querySelectorAll('a')).map((a) => a.getAttribute('href'));

      expect(textOf(flag('costUnknown'))).toContain('2 orders without a known product cost');
      expect(hrefs('costUnknown')).toEqual(['/products?cost=incomplete']);
      expect(textOf(flag('ordersWithoutSettlement'))).toContain(
        '1 order without a matched settlement entry',
      );
      expect(hrefs('ordersWithoutSettlement')).toEqual([
        '/orders?from=2026-10-01&to=2026-10-31&settlement=unmatched',
      ]);
      expect(textOf(flag('unmatchedSettlements'))).toContain(
        '3 settlement entries not matched to an order',
      );
      expect(hrefs('unmatchedSettlements')).toEqual([
        '/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date&match=unmatched',
        '/settlements?tab=reconciliation',
      ]);
      expect(textOf(flag('pricesMissing'))).toContain('1 order without a reported price');
      expect(hrefs('pricesMissing')).toEqual(['/orders?from=2026-10-01&to=2026-10-31']);

      expect(visibleText(card('kpi-product-cost').querySelector('[data-testid="kpi-without-cost"]'))).toContain(
        '2 orders without a cost (1 with no cost on the order date, 1 without a product)',
      );
      expect(
        card('kpi-product-cost').querySelector('[data-testid="kpi-without-cost"] a')?.getAttribute('href'),
      ).toBe('/products?cost=incomplete');
      expect(textOf(card('kpi-order-value').querySelector('[data-testid="kpi-prices-missing"]'))).toContain(
        '1 order without a reported price',
      );
    });

    it('links each number to its list with the same filters: payment basis uses paymentFrom/paymentTo and payment-dated entries', async () => {
      await render('/overview?scope=account&basis=payment_date&status=Delivered');
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          filters: {
            from: '2026-10-03',
            to: '2026-11-01',
            basis: 'payment_date',
            statuses: ['Delivered'],
            granularity: 'day',
          },
        }),
      );

      expect(kpiHref('kpi-orders')).toBe(
        '/orders?status=Delivered&paymentFrom=2026-10-03&paymentTo=2026-11-01',
      );
      // By payment date the status filter narrows only orders and order value: the settlement
      // amount and the product cost ignore it, so their links do too and no caveat is shown.
      expect(kpiHref('kpi-settlement')).toBe('/settlements?from=2026-10-03&to=2026-11-01');
      expect(host().querySelector('[data-testid="kpi-settlement-status-note"]')).toBeNull();
      expect(host().querySelector('[data-testid="status-filter-note"]')).toBeNull();
      expect(kpiHref('kpi-product-cost')).toBe(
        '/orders?paymentFrom=2026-10-03&paymentTo=2026-11-01',
      );
      expect(textOf(host().querySelector('[data-testid="kpi-cost-list-note"]'))).toBe(
        'The orders list shows each order’s cost, not this total.',
      );
      expect(kpiHref('kpi-expenses')).toBe('/expenses?from=2026-10-03&to=2026-11-01');
      expect(textOf(host().querySelector('[data-testid="contribution-status-note"]'))).toBe(
        'Status filter (Delivered): by payment date it narrows only the order counts and order value — this estimate covers orders of every status.',
      );

      // Status breakdown and settlement types link too.
      const statusRow = host().querySelector('[data-testid="status-table"] tr[data-status="RTO Complete"]');
      expect(statusRow?.querySelector('a')?.getAttribute('href')).toBe(
        '/orders?status=RTO%20Complete&paymentFrom=2026-10-03&paymentTo=2026-11-01',
      );
      const typeRow = host().querySelector('[data-testid="by-type-table"] tr[data-entry-type="ads_cost"]');
      expect(textOf(typeRow)).toBe('Ads cost 1 -₹120.00 (open the Ads cost entries)');
      expect(typeRow?.querySelector('a')?.getAttribute('href')).toBe(
        '/settlements?entryType=ads_cost&from=2026-10-03&to=2026-11-01',
      );

      (statusRow?.querySelector('a') as HTMLAnchorElement).click();
      await stable();
      expect(url()).toBe('/orders?status=RTO%20Complete&paymentFrom=2026-10-03&paymentTo=2026-11-01');
    });

    it('by order date with a status filter, the narrowed settlement amount is not linked to the (unfiltered) list, and says so', async () => {
      await render('/overview?scope=account&status=Delivered');
      const base = accountDashboard();
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          filters: { ...base.filters, statuses: ['Delivered'] },
          contribution: {
            ...base.contribution,
            complete: false,
            flags: { ...base.contribution.flags, unmatchedSettlements: 2 },
          },
        }),
      );

      // The card's number is plain text; the caveat offers the entries of every status instead.
      expect(kpiHref('kpi-settlement')).toBeNull();
      expect(kpiValue('kpi-settlement')).toBe('₹1,180.40');
      const note = host().querySelector('[data-testid="kpi-settlement-status-note"]') as HTMLElement;
      expect(textOf(note)).toContain('The settlements list has no status filter');
      expect(textOf(note.querySelector('a'))).toBe('Entries of every status');
      expect(note.querySelector('a')?.getAttribute('href')).toBe(
        '/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date',
      );
      // The breakdown says the same and links no type; unmatched entries (no order) stay linked.
      expect(host().querySelector('[data-testid="status-filter-note"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="by-type-table"] tbody a')).toBeNull();
      expect(
        host().querySelector('li[data-flag="unmatchedSettlements"] a')?.getAttribute('href'),
      ).toBe('/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date&match=unmatched');
      // By order date the cost follows the status filter, and so does its link.
      expect(kpiHref('kpi-product-cost')).toBe(
        '/orders?status=Delivered&from=2026-10-01&to=2026-10-31',
      );
      expect(kpiHref('kpi-orders')).toBe('/orders?status=Delivered&from=2026-10-01&to=2026-10-31');
      expect(textOf(host().querySelector('[data-testid="contribution-status-note"]'))).toBe(
        'Status filter (Delivered): only those orders’ settlement entries and product costs are included; account-level and unmatched entries and expenses count in full.',
      );
    });

    it('without a status filter there is no status note on the estimate', async () => {
      await render('/overview?scope=account');
      await flushDashboard('accounts/100', accountDashboard());
      expect(host().querySelector('[data-testid="contribution-status-note"]')).toBeNull();
      expect(kpiHref('kpi-settlement')).toBe(
        '/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date',
      );
    });

    it('labels undated entries as counted over all dates, and hides "Inputs complete" when there is nothing to estimate', async () => {
      await render('/overview?scope=account');
      const base = accountDashboard();
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          settlements: { ...base.settlements, undatedEntries: 2 },
          contribution: { ...base.contribution, amount: null, complete: true },
        }),
      );
      expect(textOf(host().querySelector('[data-testid="kpi-undated"]'))).toContain(
        '2 entries (all dates) without the order date this basis needs',
      );
      expect(host().querySelector('[data-testid="contribution-badge"]')).toBeNull();
      expect(kpiValue('kpi-contribution')).toBe('— nothing to estimate');
    });

    it('warns that cancelled / RTO / returned orders’ cost is still deducted, linking to those statuses', async () => {
      await render('/overview?scope=account');
      const base = accountDashboard();
      // Of the known 600.00, 2 orders' 250.00 is for cancelled / returned ones (still deducted).
      const cancelledDashboard = (overrides: Partial<Dashboard> = {}) =>
        accountDashboard({
          orders: {
            ...base.orders,
            statusCounts: [
              { status: 'Delivered', count: 1 },
              { status: 'RTO Complete', count: 1 },
              { status: 'cancelled', count: 1 },
            ],
          },
          productCost: {
            ...base.productCost,
            cancelledOrReturnedOrders: 2,
            cancelledOrReturnedCost: '250.00',
          },
          contribution: {
            ...base.contribution,
            complete: false,
            flags: { ...base.contribution.flags, cancelledOrReturned: 2 },
          },
          ...overrides,
        });
      await flushDashboard('accounts/100', cancelledDashboard());

      expect(textOf(host().querySelector('[data-testid="contribution-badge"]'))).toBe('Incomplete');
      const reason = host().querySelector('li[data-flag="cancelledOrReturned"]') as HTMLElement;
      expect(textOf(reason)).toBe(
        '2 orders are cancelled, RTO or returned — their product cost (₹250.00) is still deducted, so the estimate may be too low. These orders',
      );
      expect(reason.querySelector('a')?.getAttribute('href')).toBe(
        '/orders?status=RTO%20Complete&status=cancelled&from=2026-10-01&to=2026-10-31',
      );
      expect(textOf(card('kpi-product-cost').querySelector('[data-testid="kpi-cost-cancelled-note"]'))).toBe(
        'Includes ₹250.00 for 2 cancelled/RTO/returned orders.',
      );

      // By payment date with a status filter the cost ignores the filter but the status counts
      // follow it, so no list holds exactly these orders: plain text.
      setValue(select('#overview-range'), 'last30');
      input('#overview-basis-payment_date').click();
      statusBox('Delivered').click();
      await stable();
      buttonByText('Apply filters')?.click();
      await stable();
      await flushDashboard(
        'accounts/100',
        cancelledDashboard({
          filters: { ...base.filters, basis: 'payment_date', statuses: ['Delivered'] },
        }),
      );
      expect(host().querySelector('li[data-flag="cancelledOrReturned"] a')).toBeNull();
    });

    it('treats a raw status as cancelled / RTO / returned the way the API does', () => {
      expect(['CANCELLED', 'RTO Complete', 'rto_initiated', 'Customer Return', 'Returned'].every(isCancelledOrReturned)).toBe(true);
      expect(['Delivered', 'Shipped', 'Ready to ship'].some(isCancelledOrReturned)).toBe(false);
    });

    it('shows the components as already included, and TCS / TDS apart as not tax advice', async () => {
      await render('/overview?scope=account');
      await flushDashboard('accounts/100', accountDashboard());

      const components = host().querySelector('[data-testid="components-table"]') as HTMLElement;
      expect(textOf(components.querySelector('caption'))).toContain(
        'Already included in the settlement amount — not deducted again.',
      );
      expect(textOf(components.querySelector('tr[data-component="commission"]'))).toBe(
        'Commission -₹180.30',
      );
      expect(textOf(components.querySelector('tr[data-component="return"]'))).toBe(
        'Return amount ₹0.00',
      );
      expect(textOf(components.querySelector('tr[data-component="recovery"]'))).toBe(
        'Recovery — not reported',
      );
      const taxes = host().querySelector('[data-testid="tax-table"]') as HTMLElement;
      expect(textOf(taxes.querySelector('caption'))).toContain('Not tax advice or a filed liability.');
      expect(textOf(taxes.querySelector('tr[data-component="tcs"]'))).toBe('TCS -₹7.48');
      expect(textOf(taxes.querySelector('tr[data-component="tds"]'))).toBe('TDS -₹1.50');
    });
  });

  describe('account comparison (all accounts)', () => {
    const row = (id: string) =>
      host().querySelector(`[data-testid="comparison-table"] tbody tr[data-account="${id}"]`) as HTMLElement;
    const names = () =>
      Array.from(host().querySelectorAll('[data-testid="comparison-table"] tbody tr')).map((r) =>
        r.getAttribute('data-account'),
      );
    const cell = (tr: Element | null, col: string) =>
      visibleText(tr?.querySelector(`[data-col="${col}"]`));
    const sortButton = (key: string) =>
      host().querySelector(`button[data-sort-key="${key}"]`) as HTMLButtonElement;

    it('lists every account (disabled ones marked, without links) with a totals row, workspace-wide expenses and the workspace total', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());

      expect(names()).toEqual(['100', '102', '101']);
      expect(textOf(row('102').querySelector('[data-testid="disabled-badge"]'))).toBe('Disabled');
      expect(row('102').querySelector('[data-col="expenses"] a')).toBeNull();
      expect(cell(row('101'), 'productCostKnown')).toBe('— not reported');
      expect(textOf(row('101').querySelector('[data-testid="row-incomplete"]'))).toBe('Incomplete');
      expect(row('101').querySelector('[data-testid="row-incomplete"]')?.hasAttribute('title')).toBe(
        false,
      );
      expect(row('101').querySelector('[data-testid="row-cancelled"]')).toBeNull();
      // Main store is incomplete because of its RTO order, and says so.
      const mainIncomplete = row('100').querySelector('[data-testid="row-incomplete"]');
      expect(textOf(mainIncomplete)).toBe('Incomplete');
      expect(mainIncomplete?.getAttribute('title')).toBe(
        '1 cancelled/RTO/returned: their product cost is still deducted',
      );
      expect(textOf(row('100').querySelector('[data-testid="row-cancelled"]'))).toBe(
        '1 cancelled/RTO/returned (cost still deducted)',
      );
      // On the all-accounts view the warning is plain text, like the other reasons.
      const cancelled = host().querySelector('li[data-flag="cancelledOrReturned"]');
      expect(textOf(cancelled)).toBe(
        '1 order is cancelled, RTO or returned — its product cost (₹200.00) is still deducted, so the estimate may be too low.',
      );
      expect(cancelled?.querySelector('a')).toBeNull();
      expect(textOf(card('kpi-product-cost').querySelector('[data-testid="kpi-cost-cancelled-note"]'))).toBe(
        'Includes ₹200.00 for 1 cancelled/RTO/returned order.',
      );

      const totals = host().querySelector('[data-testid="totals-row"]');
      expect(cell(totals, 'orders')).toBe('5');
      expect(cell(totals, 'orderValueDiscounted')).toBe('₹2,297.50');
      expect(cell(totals, 'settlementAmount')).toBe('₹1,130.15');
      expect(cell(totals, 'productCostKnown')).toBe('₹600.00');
      expect(cell(totals, 'expenses')).toBe('₹350.00');
      expect(cell(totals, 'contribution')).toBe('₹180.15');
      const wsExpenses = host().querySelector('[data-testid="workspace-expenses-row"]');
      expect(cell(wsExpenses, 'expenses')).toBe('₹75.00');
      expect(cell(wsExpenses, 'contribution')).toBe('-₹75.00');
      const workspace = host().querySelector('[data-testid="workspace-row"]');
      expect(cell(workspace, 'expenses')).toBe('₹425.00');
      expect(cell(workspace, 'contribution')).toBe('₹105.15');

      // The cards: no per-account lists on this view, but workspace expenses link.
      expect(kpiHref('kpi-orders')).toBeNull();
      expect(kpiHref('kpi-expenses')).toBe(
        '/expenses?scope=workspace&includeAccounts=true&from=2026-10-01&to=2026-10-31',
      );
      expect(host().querySelector('[data-testid="workspace-links-note"]')).not.toBeNull();
      expect(textOf(card('kpi-expenses').querySelector('[data-testid="kpi-expenses-split"]'))).toBe(
        'Seller accounts: ₹350.00 · Workspace-wide: ₹75.00',
      );
    });

    it('sorts every column (missing amounts last), announcing it with aria-sort', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());
      const header = (key: string) => sortButton(key).closest('th') as HTMLElement;
      expect(header('displayName').getAttribute('aria-sort')).toBe('ascending');

      sortButton('settlementAmount').click();
      await stable();
      expect(header('settlementAmount').getAttribute('aria-sort')).toBe('descending');
      expect(header('displayName').hasAttribute('aria-sort')).toBe(false);
      expect(names()).toEqual(['100', '101', '102']);

      sortButton('settlementAmount').click();
      await stable();
      expect(header('settlementAmount').getAttribute('aria-sort')).toBe('ascending');
      expect(names()).toEqual(['101', '100', '102']);

      sortButton('contribution').click();
      await stable();
      expect(names()).toEqual(['100', '101', '102']);
    });

    it('an active account’s number selects that account and opens its list; its name opens its dashboard', async () => {
      await render('/overview?range=last7');
      await flushDashboard('workspaces/10', workspaceDashboard());
      const selection = TestBed.inject(SelectedSellerAccountService);
      expect(selection.selectedId()).toBe('100');

      const link = row('101').querySelector('[data-col="orders"] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/orders?from=2026-10-01&to=2026-10-31');
      expect(
        row('101').querySelector('[data-col="settlementAmount"] a')?.getAttribute('href'),
      ).toBe('/settlements?from=2026-10-01&to=2026-10-31&dateBasis=order_date');
      expect(
        Array.from(row('100').querySelectorAll('th a')).map((a) => a.getAttribute('href')),
      ).toEqual(['/overview?scope=account&range=last7']);

      link.click();
      await stable();
      expect(selection.selectedId()).toBe('101');
      expect(url()).toBe('/orders?from=2026-10-01&to=2026-10-31');
    });
  });

  describe('trend', () => {
    it('draws the trend with gaps for buckets without rows and offers the data table', async () => {
      await render('/overview?scope=account');
      await flushDashboard('accounts/100', accountDashboard());
      expect(host().querySelector('[data-testid="trend-svg"]')).not.toBeNull();
      expect(host().querySelector('g[data-bucket="2026-10-02"]')?.getAttribute('data-missing')).toBe(
        'true',
      );
      expect(buttonByText('Show data table')?.getAttribute('aria-expanded')).toBe('false');
      expect(textOf(select('#overview-granularity').options[0])).toBe('Automatic (day)');
    });
  });

  describe('states', () => {
    it('shows loading, then an error with "Try again" that re-sends the request', async () => {
      await render();
      expect(dashboardEl().getAttribute('data-state')).toBe('loading');
      expect(textOf(dashboardEl())).toBe('Loading the dashboard…');

      expectDashboard('workspaces/10').flush(
        errorBody('VALIDATION_ERROR', 'The range can be at most 731 days.'),
        { status: 400, statusText: 'Bad Request' },
      );
      await stable();
      expect(dashboardEl().getAttribute('data-state')).toBe('error');
      expect(textOf(host().querySelector('[data-testid="dashboard-error"]'))).toBe(
        'The range can be at most 731 days.',
      );

      buttonByText('Try again')?.click();
      await stable();
      await flushDashboard('workspaces/10', workspaceDashboard());
      expect(dashboardEl().getAttribute('data-state')).toBe('ready');
    });

    it('says when the range has no data at all — entries without a date (counted over all dates) do not change that', async () => {
      await render('/overview?scope=account');
      const base = accountDashboard();
      await flushDashboard(
        'accounts/100',
        accountDashboard({
          orders: { ...base.orders, count: 0, units: null, statusCounts: [], orderValueDiscounted: null, orderValueListed: null },
          settlements: { ...base.settlements, amount: null, count: 0, byType: [], undatedEntries: 3 },
          expenses: { ...base.expenses, amount: null, count: 0, accountAmount: null },
        }),
      );
      expect(textOf(host().querySelector('[data-testid="dashboard-empty"]'))).toContain(
        'No data in this date range.',
      );
      expect(host().querySelector('[data-testid="kpi-orders"]')).toBeNull();
    });

    it('keeps the API status panel, compact, at the bottom', async () => {
      await render();
      await flushDashboard('workspaces/10', workspaceDashboard());
      const panel = host().querySelector('app-api-status section') as HTMLElement;
      expect(panel.getAttribute('data-state')).toBe('ok');
      expect(panel.classList).toContain('p-3');
      expect(host().lastElementChild?.tagName.toLowerCase()).toBe('app-api-status');
    });

    it('asks for an account when none is active (account view) and sends no dashboard request', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/overview?scope=account');
      await stable();
      httpTesting.expectOne('/api/v1/health').flush(HEALTH);
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [] });
      await stable();
      expect(host().querySelector('[data-testid="no-accounts"]')).not.toBeNull();
      expect(dashboardEl().getAttribute('data-state')).toBe('idle');
    });
  });
});
