import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  EXPENSE_CATEGORIES,
  ME_OWNER,
  errorBody,
  sellerAccount,
  textOf,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { FileSaverService } from '../../core/reports/file-saver.service';
import { ReportsPage } from './reports-page';

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet' });

describe('ReportsPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;
  let save: ReturnType<typeof vi.fn>;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const card = (id: string) => host().querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const download = (id: string) =>
    Array.from(card(id).querySelectorAll('button')).find(
      (b) => textOf(b) === 'Download CSV',
    ) as HTMLButtonElement;
  const el = <T extends HTMLElement>(selector: string) => host().querySelector(selector) as T;
  const box = (prefix: string, label: string) => {
    const lbl = Array.from(host().querySelectorAll(`label[for^="${prefix}-"]`)).find((l) =>
      textOf(l).startsWith(label),
    );
    return host().querySelector(`#${lbl?.getAttribute('for')}`) as HTMLInputElement;
  };

  function setValue(target: HTMLInputElement | HTMLSelectElement, value: string) {
    target.value = value;
    target.dispatchEvent(new Event('change'));
  }

  function csv(req: TestRequest, filename: string): Blob {
    const blob = new Blob(['﻿header\r\n'], { type: 'text/csv' });
    req.flush(blob, { headers: { 'Content-Disposition': `attachment; filename="${filename}"` } });
    return blob;
  }

  async function render(accounts = [MAIN]): Promise<void> {
    TestBed.inject(AuthStateService).setSession(ME_OWNER);
    harness = await RouterTestingHarness.create('/reports');
    await stable();
    httpTesting.expectOne('/api/v1/expenses/categories').flush({ items: EXPENSE_CATEGORIES });
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: accounts });
    await stable();
    if (accounts.length > 0) {
      httpTesting.expectOne(`/api/v1/accounts/${accounts[0].id}/orders/statuses`).flush({
        items: [
          { status: 'Delivered', count: 40 },
          { status: 'RTO Complete', count: 3 },
        ],
      });
      await stable();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    save = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'reports', component: ReportsPage }], withComponentInputBinding()),
        provideApiHttpClient(),
        provideHttpClientTesting(),
        { provide: FileSaverService, useValue: { save } },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('shows three export cards with their column lists and the as-reported note', async () => {
    await render();
    const headings = Array.from(host().querySelectorAll('app-export-card h2')).map(textOf);
    expect(headings).toEqual(['Orders', 'Settlements', 'Expenses']);
    const columns = (id: string) => card(id).querySelector('[data-testid="columns"]');
    expect(textOf(columns('export-orders')?.querySelector('summary'))).toMatch(
      /^Columns \(\d+\)$/,
    );
    expect(textOf(columns('export-orders'))).toContain('Product cost state, unit cost and total');
    expect(textOf(columns('export-orders'))).toContain('Source import file');
    expect(textOf(columns('export-settlements'))).toContain('TCS and TDS');
    expect(textOf(columns('export-settlements'))).toContain('Match state, method and matched order');
    expect(textOf(columns('export-expenses'))).toContain('Amount');
    expect(textOf(host())).toContain('A file holds at most 1,00,000 rows');
    expect(textOf(host())).toContain('Amounts are as reported by Meesho — not profit.');
  });

  it('downloads the orders with the chosen filters (order date) and saves the file under the server’s name', async () => {
    await render();
    setValue(el('#export-orders-date-from'), '2026-10-01');
    setValue(el('#export-orders-date-to'), '2026-10-31');
    box('export-orders-status', 'Delivered').click();
    box('export-orders-status', 'RTO Complete').click();
    setValue(el('#export-orders-settlement'), 'unmatched');
    await stable();

    download('export-orders').click();
    await stable();
    expect(card('export-orders').getAttribute('data-state')).toBe('busy');
    expect(textOf(card('export-orders').querySelector('[data-testid="download-status"]'))).toBe(
      'Preparing the file…',
    );
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/reports/orders.csv');
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/orders.csv?status=Delivered&status=RTO%20Complete&from=2026-10-01&to=2026-10-31&settlement=unmatched',
    );
    const blob = csv(req, 'Main-store-orders-2026-10-01_2026-10-31.csv');
    await stable();

    expect(save).toHaveBeenCalledWith(blob, 'Main-store-orders-2026-10-01_2026-10-31.csv');
    expect(textOf(card('export-orders').querySelector('[data-testid="download-status"]'))).toBe(
      'Downloaded Main-store-orders-2026-10-01_2026-10-31.csv.',
    );
  });

  it('by first settlement payment date, the orders export sends paymentFrom / paymentTo', async () => {
    await render();
    el<HTMLInputElement>('#export-orders-basis-payment').click();
    setValue(el('#export-orders-date-from'), '2026-10-01');
    setValue(el('#export-orders-date-to'), '2026-10-15');
    await stable();
    expect(textOf(card('export-orders').querySelector('app-date-range legend'))).toBe(
      'Payment date',
    );

    download('export-orders').click();
    await stable();
    const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/reports/orders.csv');
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/orders.csv?paymentFrom=2026-10-01&paymentTo=2026-10-15',
    );
    csv(req, 'orders.csv');
    await stable();
  });

  it('shows the server’s 422 "too many rows" message next to the filters, and saves nothing', async () => {
    await render();
    download('export-orders').click();
    await stable();
    httpTesting
      .expectOne('/api/v1/accounts/100/reports/orders.csv')
      .flush(
        new Blob(
          [
            JSON.stringify(
              errorBody(
                'TOO_MANY_ROWS',
                'This export has 120000 rows, more than the 100000 allowed. Narrow the filters.',
              ),
            ),
          ],
          { type: 'application/json' },
        ),
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    // The message is read from the Blob body first (asynchronous).
    await vi.waitFor(() =>
      expect(card('export-orders').getAttribute('data-state')).toBe('error'),
    );
    await stable();

    const alert = card('export-orders').querySelector('[data-testid="download-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(textOf(alert)).toContain('The file was not created.');
    expect(textOf(alert)).toContain(
      'This export has 120000 rows, more than the 100000 allowed. Narrow the filters.',
    );
    expect(textOf(alert)).toContain('Narrow the filters (a shorter date range');
    expect(save).not.toHaveBeenCalled();
    expect(card('export-orders').getAttribute('data-state')).toBe('error');

    // Trying again clears the error.
    download('export-orders').click();
    await stable();
    expect(card('export-orders').querySelector('[data-testid="download-error"]')).toBeNull();
    csv(httpTesting.expectOne('/api/v1/accounts/100/reports/orders.csv'), 'orders.csv');
    await stable();
  });

  it('downloads settlements by order date with entry types, match and superseded entries', async () => {
    await render();
    setValue(el('#export-settlements-basis'), 'order_date');
    setValue(el('#export-settlements-date-from'), '2026-10-01');
    box('export-settlements-type', 'Order payment').click();
    box('export-settlements-type', 'Ads cost').click();
    setValue(el('#export-settlements-match'), 'account_level');
    el<HTMLInputElement>('#export-settlements-superseded').click();
    await stable();

    download('export-settlements').click();
    await stable();
    const req = httpTesting.expectOne(
      (r) => r.url === '/api/v1/accounts/100/reports/settlements.csv',
    );
    expect(req.request.urlWithParams).toBe(
      '/api/v1/accounts/100/reports/settlements.csv?entryType=order_payment&entryType=ads_cost&from=2026-10-01&dateBasis=order_date&match=account_level&includeSuperseded=true',
    );
    csv(req, 'Main-store-settlements.csv');
    await stable();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('downloads expenses of the account, workspace-wide only, or with every account’s', async () => {
    await render();
    setValue(el('#export-expenses-date-from'), '2026-10-01');
    box('export-expenses-category', EXPENSE_CATEGORIES[0].label).click();
    await stable();

    download('export-expenses').click();
    await stable();
    const account = httpTesting.expectOne(
      (r) => r.url === '/api/v1/accounts/100/reports/expenses.csv',
    );
    expect(account.request.urlWithParams).toBe(
      `/api/v1/accounts/100/reports/expenses.csv?from=2026-10-01&category=${EXPENSE_CATEGORIES[0].key}`,
    );
    csv(account, 'expenses.csv');
    await stable();

    setValue(el('#export-expenses-scope'), 'workspace');
    await stable();
    download('export-expenses').click();
    await stable();
    const workspace = httpTesting.expectOne(
      (r) => r.url === '/api/v1/workspaces/10/reports/expenses.csv',
    );
    expect(workspace.request.params.get('scope')).toBe('workspace');
    csv(workspace, 'expenses.csv');
    await stable();

    setValue(el('#export-expenses-scope'), 'all');
    await stable();
    download('export-expenses').click();
    await stable();
    const all = httpTesting.expectOne((r) => r.url === '/api/v1/workspaces/10/reports/expenses.csv');
    expect(all.request.params.get('scope')).toBe('all');
    csv(all, 'expenses.csv');
    await stable();
  });

  it('aborts a download in flight when another seller account is picked, and saves nothing', async () => {
    await render([MAIN, OUTLET]);
    download('export-orders').click();
    download('export-settlements').click();
    await stable();
    const orders = httpTesting.expectOne('/api/v1/accounts/100/reports/orders.csv');
    const settlements = httpTesting.expectOne('/api/v1/accounts/100/reports/settlements.csv');

    setValue(el('#reports-account'), '101');
    await stable();
    expect(orders.cancelled).toBe(true);
    expect(settlements.cancelled).toBe(true);
    expect(card('export-orders').getAttribute('data-state')).toBe('idle');
    expect(card('export-settlements').getAttribute('data-state')).toBe('idle');
    expect(save).not.toHaveBeenCalled();
    httpTesting.expectOne('/api/v1/accounts/101/orders/statuses').flush({ items: [] });
    await stable();

    // The new account's download runs normally.
    download('export-orders').click();
    await stable();
    csv(httpTesting.expectOne('/api/v1/accounts/101/reports/orders.csv'), 'Outlet-orders.csv');
    await stable();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('aborts an expenses download in flight when "Whose expenses" changes', async () => {
    await render();
    download('export-expenses').click();
    await stable();
    const req = httpTesting.expectOne('/api/v1/accounts/100/reports/expenses.csv');

    setValue(el('#export-expenses-scope'), 'all');
    await stable();
    expect(req.cancelled).toBe(true);
    expect(card('export-expenses').getAttribute('data-state')).toBe('idle');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not download with a date range that ends before it starts', async () => {
    await render();
    setValue(el('#export-orders-date-from'), '2026-10-31');
    setValue(el('#export-orders-date-to'), '2026-10-01');
    await stable();
    download('export-orders').click();
    await stable();
    httpTesting.expectNone((r) => r.url === '/api/v1/accounts/100/reports/orders.csv');
    expect(card('export-orders').querySelector('[data-testid="date-range-error"]')).not.toBeNull();
    expect(document.activeElement).toBe(el('#export-orders-date-from'));
  });

  it('without an active account, only the workspace-wide expenses export runs', async () => {
    await render([]);
    expect(download('export-orders').getAttribute('aria-disabled')).toBe('true');
    download('export-orders').click();
    await stable();
    httpTesting.expectNone((r) => r.url.includes('/reports/'));

    setValue(el('#export-expenses-scope'), 'all');
    await stable();
    expect(download('export-expenses').hasAttribute('aria-disabled')).toBe(false);
    download('export-expenses').click();
    await stable();
    csv(
      httpTesting.expectOne((r) => r.url === '/api/v1/workspaces/10/reports/expenses.csv'),
      'expenses.csv',
    );
    await stable();
  });
});
