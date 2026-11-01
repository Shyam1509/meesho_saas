import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
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
  errorBody,
  orderSummary,
  paged,
  sellerAccount,
  textOf,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { OrderStatusCount, OrderSummary } from '../../core/orders/order.models';
import { OrdersPage } from './orders-page';

@Component({ template: 'order page' })
class StubOrderPage {}

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet' });
const STATUSES: OrderStatusCount[] = [
  { status: 'Delivered', count: 40 },
  { status: 'RTO Complete', count: 3 },
];

describe('OrdersPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const list = () => host().querySelector('[data-testid="orders-list"]') as HTMLElement;
  const rows = () => Array.from(host().querySelectorAll('[data-testid="orders-table"] tbody tr'));
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const input = (selector: string) => host().querySelector(selector) as HTMLInputElement;
  const select = (selector: string) => host().querySelector(selector) as HTMLSelectElement;
  const header = (key: string) =>
    host().querySelector(`[data-sort-key="${key}"]`)?.closest('th') as HTMLTableCellElement;
  const sortButton = (key: string) =>
    host().querySelector(`button[data-sort-key="${key}"]`) as HTMLButtonElement;
  const statusBox = (label: string) => {
    const lbl = Array.from(host().querySelectorAll('app-checkbox-group label')).find((l) =>
      textOf(l).startsWith(label),
    );
    return host().querySelector(`#${lbl?.getAttribute('for')}`) as HTMLInputElement;
  };

  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event = 'change') {
    el.value = value;
    el.dispatchEvent(new Event(event));
  }

  function expectList(accountId = '100'): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/accounts/${accountId}/orders`);
  }

  async function flushList(
    items: OrderSummary[] = [orderSummary()],
    page = 1,
    total = items.length,
    accountId = '100',
  ): Promise<TestRequest> {
    const req = expectList(accountId);
    req.flush(paged(items, page, total, 25));
    await stable();
    return req;
  }

  /** Opens `start`, answers the accounts and the statuses; the first list request stays open. */
  async function render(start = '/orders', accounts = [MAIN, OUTLET]): Promise<void> {
    TestBed.inject(AuthStateService).setSession(ME_OWNER);
    harness = await RouterTestingHarness.create(start);
    httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: accounts });
    await stable();
    httpTesting
      .expectOne(`/api/v1/accounts/${accounts[0]?.id ?? '100'}/orders/statuses`)
      .flush({ items: STATUSES });
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'orders', component: OrdersPage },
            { path: 'accounts/:accountId/orders/:orderId', component: StubOrderPage },
          ],
          withComponentInputBinding(),
        ),
        provideLocationMocks(),
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

  describe('filters and the URL', () => {
    it('reads filters, sort and page from the URL, sends them and shows them in the form', async () => {
      await render(
        '/orders?q=SO-1&status=Delivered&status=RTO%20Complete&from=2026-10-01&to=2026-10-31&settlement=unmatched&sort=subOrderNo&page=2',
      );
      const req = expectList();
      expect(req.request.params.get('q')).toBe('SO-1');
      expect(req.request.params.getAll('status')).toEqual(['Delivered', 'RTO Complete']);
      expect(req.request.params.get('from')).toBe('2026-10-01');
      expect(req.request.params.get('to')).toBe('2026-10-31');
      expect(req.request.params.get('settlement')).toBe('unmatched');
      expect(req.request.params.get('sort')).toBe('subOrderNo');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('25');
      req.flush(paged([orderSummary()], 2, 26, 25));
      await stable();

      expect(input('#orders-q').value).toBe('SO-1');
      expect(input('#orders-date-from').value).toBe('2026-10-01');
      expect(input('#orders-date-to').value).toBe('2026-10-31');
      expect(select('#orders-settlement').value).toBe('unmatched');
      expect(textOf(host().querySelector('app-checkbox-group summary'))).toBe('Status: 2 selected');
      expect(statusBox('Delivered').checked).toBe(true);
      expect(header('subOrderNo').getAttribute('aria-sort')).toBe('ascending');
      expect(buttonByText('Clear filters')).toBeDefined();
    });

    it('falls back to the defaults for invalid URL values', async () => {
      const tooLong = 'S'.repeat(65);
      await render(
        `/orders?sort=bogus&page=0&from=2026-13-01&settlement=maybe&status=&status=${tooLong}`,
      );
      const req = expectList();
      expect(req.request.params.get('sort')).toBe('-orderDate');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.keys()).toEqual(['page', 'pageSize', 'sort']);
      req.flush(paged([orderSummary()]));
      await stable();
      expect(header('orderDate').getAttribute('aria-sort')).toBe('descending');
      expect(buttonByText('Clear filters')).toBeUndefined();
    });

    it('uses page 1 for a page past the API’s limit of 2000', async () => {
      await render('/orders?page=2001');
      const first = expectList();
      expect(first.request.params.get('page')).toBe('1');
      first.flush(paged([orderSummary()]));
      await stable();

      await harness.navigateByUrl('/orders?page=2000');
      const last = expectList();
      expect(last.request.params.get('page')).toBe('2000');
      last.flush(paged([], 2000, 1, 25));
      await stable();
    });

    it('drops a date range whose start is after its end', async () => {
      await render('/orders?from=2026-10-31&to=2026-10-01');
      const req = expectList();
      expect(req.request.params.has('from')).toBe(false);
      expect(req.request.params.has('to')).toBe(false);
      req.flush(paged([]));
    });

    it('applies the filters to the URL (back to page 1) and loads with them', async () => {
      await render('/orders?page=3&sort=subOrderNo');
      await flushList([orderSummary()], 3, 80);

      setValue(input('#orders-q'), '  KURTA ', 'input');
      statusBox('RTO Complete').click();
      setValue(input('#orders-date-from'), '2026-10-01');
      setValue(input('#orders-date-to'), '2026-10-15');
      setValue(select('#orders-settlement'), 'matched');
      await stable();
      buttonByText('Apply filters')?.click();
      await stable();

      expect(url()).toBe(
        '/orders?q=KURTA&status=RTO%20Complete&from=2026-10-01&to=2026-10-15&settlement=matched&sort=subOrderNo',
      );
      const req = expectList();
      expect(req.request.params.get('q')).toBe('KURTA');
      expect(req.request.params.getAll('status')).toEqual(['RTO Complete']);
      expect(req.request.params.get('settlement')).toBe('matched');
      expect(req.request.params.get('page')).toBe('1');
      req.flush(paged([orderSummary()]));
    });

    it('does not apply a date range that ends before it starts', async () => {
      await render();
      await flushList();

      setValue(input('#orders-date-from'), '2026-10-31');
      setValue(input('#orders-date-to'), '2026-10-01');
      await stable();
      expect(textOf(host().querySelector('[data-testid="date-range-error"]'))).toBe(
        'The start date must be on or before the end date.',
      );
      expect(input('#orders-date-from').getAttribute('aria-invalid')).toBe('true');

      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/orders');
      expect(document.activeElement).toBe(input('#orders-date-from'));
      httpTesting.expectNone((r) => r.url === '/api/v1/accounts/100/orders');
    });

    it('"Clear filters" keeps only the sort', async () => {
      await render('/orders?q=SO&settlement=matched&sort=-currentStatus&page=2');
      await flushList([orderSummary()], 2, 30);

      buttonByText('Clear filters')?.click();
      await stable();
      expect(url()).toBe('/orders?sort=-currentStatus');
      await flushList();
      expect(input('#orders-q').value).toBe('');
    });

    it('the back button restores the previous view and its form values', async () => {
      await render();
      await flushList();
      // The harness navigates directly; listen to history changes as the running app does.
      TestBed.inject(Router).setUpLocationChangeListener();

      setValue(input('#orders-q'), 'SO-77', 'input');
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/orders?q=SO-77');
      await flushList([]);

      TestBed.inject(Location).back();
      // The router reacts to a history change on the next macrotask.
      await vi.waitFor(() => expect(url()).toBe('/orders'), { timeout: 10000 });
      await stable();
      const req = await flushList();
      expect(req.request.params.has('q')).toBe(false);
      expect(input('#orders-q').value).toBe('');
    });
  });

  describe('sorting', () => {
    it('toggles the direction of the sorted column and starts others ascending (dates descending)', async () => {
      await render();
      await flushList();
      expect(header('orderDate').getAttribute('aria-sort')).toBe('descending');
      expect(header('subOrderNo').hasAttribute('aria-sort')).toBe(false);

      sortButton('orderDate').click();
      await stable();
      expect(url()).toBe('/orders?sort=orderDate');
      expect((await flushList()).request.params.get('sort')).toBe('orderDate');
      expect(header('orderDate').getAttribute('aria-sort')).toBe('ascending');

      sortButton('subOrderNo').click();
      await stable();
      expect(url()).toBe('/orders?sort=subOrderNo');
      await flushList();
      expect(header('subOrderNo').getAttribute('aria-sort')).toBe('ascending');
      expect(header('orderDate').hasAttribute('aria-sort')).toBe(false);

      sortButton('subOrderNo').click();
      await stable();
      expect(url()).toBe('/orders?sort=-subOrderNo');
      await flushList();

      sortButton('currentStatus').click();
      await stable();
      expect(url()).toBe('/orders?sort=currentStatus');
      await flushList();
    });

    it('a new sort goes back to page 1', async () => {
      await render('/orders?page=4');
      await flushList([orderSummary()], 4, 100);
      sortButton('subOrderNo').click();
      await stable();
      expect(url()).toBe('/orders?sort=subOrderNo');
      expect((await flushList([])).request.params.get('page')).toBe('1');
    });
  });

  describe('pagination', () => {
    it('pages through the list via the URL, keeping the table while the next page loads', async () => {
      await render();
      await flushList(
        Array.from({ length: 25 }, (_, i) => orderSummary({ id: `${i + 1}`, subOrderNo: `SO-${i}` })),
        1,
        60,
      );
      expect(textOf(host().querySelector('app-pager'))).toContain('Showing 1–25 of 60 orders');

      buttonByText('Next page')?.click();
      await stable();
      expect(url()).toBe('/orders?page=2');
      expect(list().getAttribute('aria-busy')).toBe('true');
      expect(rows().length).toBe(25);
      const req = expectList();
      expect(req.request.params.get('page')).toBe('2');
      req.flush(paged([orderSummary({ id: '99', subOrderNo: 'SO-99' })], 2, 60, 25));
      await stable();
      expect(list().getAttribute('aria-busy')).toBe('false');
      expect(textOf(host().querySelector('app-pager'))).toContain('Showing 26–50 of 60 orders');
      expect(rows().map((r) => textOf(r.querySelector('th a')))).toEqual(['SO-99']);
    });
  });

  describe('states and rows', () => {
    it('shows loading, then the rows with links, INR amounts, "—" for missing values', async () => {
      await render();
      expect(list().dataset['state']).toBe('loading');
      expect(textOf(list().querySelector('[role="status"]'))).toBe('Loading orders…');

      await flushList([
        orderSummary(),
        orderSummary({
          id: '9002',
          subOrderNo: 'SO-1002',
          orderNo: null,
          supplierDiscountedPrice: null,
          supplierListedPrice: '0',
          quantity: null,
          currentStatusObservedAt: null,
          settlement: { entryCount: 0, amount: null },
          productCost: { state: 'unknown', unitCost: null, effectiveFrom: null, total: null },
        }),
      ]);
      expect(list().dataset['state']).toBe('ready');
      expect(textOf(host().querySelector('caption'))).toBe('Orders of Main store');
      const [first, second] = rows();
      expect(first.querySelector('th a')?.getAttribute('href')).toBe('/accounts/100/orders/9001');
      const cells = (row: Element) => Array.from(row.querySelectorAll('td')).map((td) => textOf(td));
      expect(cells(first)).toEqual([
        '5 Oct 2026',
        'Cotton kurta SKU KURTA-M · Size M',
        '1',
        expect.stringMatching(/^Delivered as of \d{1,2} Oct 2026, \d{1,2}:\d{2} [ap]m$/),
        '₹1,249.50',
        '₹1,199.00',
        '₹250.00 1 × ₹250.00 from 1 Oct 2026',
        '₹1,180.40 1 entry',
      ]);
      expect(cells(second)).toEqual([
        '5 Oct 2026',
        'Cotton kurta SKU KURTA-M · Size M',
        '—',
        'Delivered',
        '₹0.00',
        '— not reported',
        'Unknown cost: add a unit cost for this product',
        'No settlement matched',
      ]);
      expect(textOf(host().querySelector('[data-testid="result-announcement"]'))).toBe(
        '2 orders found.',
      );
    });

    it('shows the product cost: known total with its hint, amber "Unknown cost" linking to the product, "No SKU" — never ₹0 for a missing cost', async () => {
      await render();
      await flushList([
        orderSummary({
          quantity: 2,
          productCost: {
            state: 'known',
            unitCost: '125.2500',
            effectiveFrom: '2026-10-02',
            total: '250.5000',
          },
        }),
        orderSummary({
          id: '9002',
          subOrderNo: 'SO-1002',
          productId: '701',
          productCost: { state: 'unknown', unitCost: null, effectiveFrom: null, total: null },
        }),
        orderSummary({
          id: '9003',
          subOrderNo: 'SO-1003',
          sku: null,
          productId: null,
          productCost: { state: 'no_product', unitCost: null, effectiveFrom: null, total: null },
        }),
        orderSummary({
          id: '9004',
          subOrderNo: 'SO-1004',
          sku: 'OLD-SKU',
          productId: null,
          productCost: { state: 'no_product', unitCost: null, effectiveFrom: null, total: null },
        }),
      ]);
      const headers = Array.from(host().querySelectorAll('[data-testid="orders-table"] thead th'));
      expect(headers.map((th) => textOf(th))).toContain('Product cost');
      const costCell = (i: number) =>
        rows()[i].querySelector('[data-testid="order-product-cost"]') as HTMLElement;

      expect(textOf(costCell(0))).toBe('₹250.50 2 × ₹125.25 from 2 Oct 2026');
      const unknown = costCell(1).querySelector('a') as HTMLAnchorElement;
      expect(unknown.getAttribute('href')).toBe('/products/701');
      expect(unknown.className).toContain('text-amber-800');
      expect(textOf(costCell(1))).not.toContain('₹');
      expect(textOf(costCell(2))).toBe('No SKU');
      expect(costCell(2).querySelector('a')).toBeNull();
      // A SKU imported before products existed: not "No SKU" next to a SKU.
      expect(textOf(costCell(3))).toBe('No product yet: open Products & costs Use “Sync from orders”');
      expect(costCell(3).querySelector('a')?.getAttribute('href')).toBe('/products');
    });

    it('shows an error with "Try again"', async () => {
      await render();
      expectList().flush(errorBody('INTERNAL_ERROR', 'Boom.'), {
        status: 500,
        statusText: 'Server Error',
      });
      await stable();
      const alert = textOf(list().querySelector('[role="alert"]'));
      expect(alert).toContain('The orders could not be loaded.');
      expect(alert).toContain('Boom. (request ID req-1)');
      buttonByText('Try again')?.click();
      await stable();
      await flushList();
      expect(rows().length).toBe(1);
    });

    it('shows an empty state linking to Imports when the account has no orders', async () => {
      await render();
      await flushList([]);
      const empty = host().querySelector('[data-testid="no-orders"]') as HTMLElement;
      expect(textOf(empty)).toContain('No orders for this account yet.');
      expect(empty.querySelector('a')?.getAttribute('href')).toBe('/imports');
      expect(host().querySelector('[data-testid="no-results"]')).toBeNull();
    });

    it('shows "no results" with "Clear filters" when filters match nothing', async () => {
      await render('/orders?status=Delivered');
      await flushList([]);
      const none = host().querySelector('[data-testid="no-results"]') as HTMLElement;
      expect(textOf(none)).toContain('No orders match these filters.');
      buttonByText('Clear filters', none)?.click();
      await stable();
      expect(url()).toBe('/orders');
      await flushList([]);
    });

    it('says so in the status filter when the statuses cannot be loaded', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/orders');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/statuses')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await flushList();
      expect(textOf(host().querySelector('app-checkbox-group fieldset p'))).toBe(
        'The statuses could not be loaded.',
      );
    });
  });

  describe('seller account', () => {
    it('loads the other account’s orders and statuses from its first page', async () => {
      await render('/orders?page=2&q=SO');
      await flushList([orderSummary()], 2, 30);

      setValue(select('#orders-account'), '101');
      await stable();
      expect(url()).toBe('/orders?q=SO');
      httpTesting.expectOne('/api/v1/accounts/101/orders/statuses').flush({ items: [] });
      const req = expectList('101');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('q')).toBe('SO');
      req.flush(paged([]));
      await stable();
      // No request for the old page number of the new account (afterEach verifies none is open).
    });

    it('shows the picker’s empty state and loads no orders without an active account', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/orders');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [] });
      await stable();
      expect(textOf(host().querySelector('[data-testid="no-accounts"]'))).toContain(
        'Orders are kept per seller account.',
      );
      expect(host().querySelector('app-filter-bar')).toBeNull();
    });
  });
});
