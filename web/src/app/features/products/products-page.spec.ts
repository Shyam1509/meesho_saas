import { provideLocationMocks } from '@angular/common/testing';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  convertToParamMap,
  provideRouter,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_MEMBER,
  ME_OWNER,
  errorBody,
  paged,
  productDetail,
  productSummary,
  sellerAccount,
  textOf,
  typeInto,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { ProductSummary } from '../../core/products/product.models';
import { ProductsPage, describeSyncResult, readProductsView } from './products-page';

@Component({ template: 'product page' })
class StubProductPage {}

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });

describe('ProductsPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const list = () => host().querySelector('[data-testid="products-list"]') as HTMLElement;
  const rows = () => Array.from(host().querySelectorAll('[data-testid="products-table"] tbody tr'));
  const row = (id: string) => host().querySelector(`tr[data-product-id="${id}"]`) as HTMLElement;
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
  const notice = () => textOf(host().querySelector('[data-testid="products-notice"]'));
  const dialog = () => host().querySelector('[role="dialog"]') as HTMLElement | null;
  const dialogInput = (name: string) =>
    dialog()?.querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement;

  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event = 'change') {
    el.value = value;
    el.dispatchEvent(new Event(event));
  }

  function expectList(accountId = '100'): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/accounts/${accountId}/products`);
  }

  async function flushList(
    items: ProductSummary[] = [productSummary()],
    page = 1,
    total = items.length,
  ): Promise<TestRequest> {
    const req = expectList();
    req.flush(paged(items, page, total, 25));
    await stable();
    return req;
  }

  /** Opens `start` and answers the accounts; the first list request stays open. */
  async function render(start = '/products', me: MeResponse = ME_OWNER): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    harness = await RouterTestingHarness.create(start);
    httpTesting
      .expectOne(`/api/v1/workspaces/${me.workspaces[0].id}/accounts`)
      .flush({ items: [MAIN] });
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'products', component: ProductsPage },
            { path: 'products/:productId', component: StubProductPage },
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
      await render('/products?q=KUR&status=archived&cost=missing&sort=-orderCount&page=2');
      const req = expectList();
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/products?page=2&pageSize=25&sort=-orderCount&q=KUR&status=archived&cost=missing',
      );
      req.flush(paged([productSummary()], 2, 26, 25));
      await stable();

      expect(input('#products-q').value).toBe('KUR');
      expect(select('#products-status').value).toBe('archived');
      expect(select('#products-cost').value).toBe('missing');
      expect(header('orderCount').getAttribute('aria-sort')).toBe('descending');
      expect(header('sku').hasAttribute('aria-sort')).toBe(false);
      expect(buttonByText('Clear filters')).toBeDefined();
    });

    it('falls back to the defaults (active, sorted by SKU) for invalid values', async () => {
      await render('/products?status=deleted&cost=maybe&sort=price&page=0');
      const req = expectList();
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/products?page=1&pageSize=25&sort=sku&status=active',
      );
      req.flush(paged([productSummary()]));
      await stable();
      expect(header('sku').getAttribute('aria-sort')).toBe('ascending');
      expect(buttonByText('Clear filters')).toBeUndefined();
    });

    it('sends cost=incomplete from the URL and offers it in the form', async () => {
      await render('/products?cost=incomplete');
      const req = expectList();
      expect(req.request.params.get('cost')).toBe('incomplete');
      req.flush(paged([productSummary()]));
      await stable();
      expect(select('#products-cost').value).toBe('incomplete');
      expect(
        Array.from(select('#products-cost').options).map((o) => [o.value, textOf(o)]),
      ).toEqual([
        ['', 'Any'],
        ['missing', 'Missing today'],
        ['known', 'Known today'],
        ['incomplete', 'Cost incomplete'],
      ]);
      expect(select('#products-cost').getAttribute('aria-describedby')).toBe('products-cost-hint');
    });

    it('readProductsView reads the defaults from an empty query', () => {
      expect(readProductsView(convertToParamMap({}))).toEqual({
        q: '',
        status: 'active',
        cost: null,
        sort: 'sku',
        page: 1,
      });
    });

    it('applies the filters to the URL (back to page 1), leaving out the defaults', async () => {
      await render('/products?page=3&sort=name');
      await flushList([productSummary()], 3, 80);

      setValue(input('#products-q'), '  kurta ', 'input');
      setValue(select('#products-status'), 'all');
      setValue(select('#products-cost'), 'known');
      buttonByText('Apply filters')?.click();
      await stable();

      expect(url()).toBe('/products?q=kurta&status=all&cost=known&sort=name');
      const req = expectList();
      expect(req.request.params.get('q')).toBe('kurta');
      expect(req.request.params.get('status')).toBe('all');
      expect(req.request.params.get('cost')).toBe('known');
      expect(req.request.params.get('page')).toBe('1');
      req.flush(paged([productSummary()]));
      await stable();

      // Back to the default status: it leaves the URL.
      setValue(select('#products-status'), 'active');
      setValue(select('#products-cost'), '');
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/products?q=kurta&sort=name');
      expectList().flush(paged([productSummary()]));
      await stable();
    });

    it('"Clear filters" keeps only the sort', async () => {
      await render('/products?q=x&cost=missing&status=all&sort=-sku&page=2');
      await flushList([productSummary()], 2, 30);
      buttonByText('Clear filters')?.click();
      await stable();
      expect(url()).toBe('/products?sort=-sku');
      expectList().flush(paged([productSummary()]));
      await stable();
    });
  });

  describe('sorting', () => {
    it('toggles the sorted column, starts text columns ascending and numbers descending', async () => {
      await render();
      await flushList();

      sortButton('sku').click();
      await stable();
      expect(url()).toBe('/products?sort=-sku');
      expectList().flush(paged([productSummary()]));
      await stable();
      expect(header('sku').getAttribute('aria-sort')).toBe('descending');

      sortButton('currentUnitCost').click();
      await stable();
      expect(url()).toBe('/products?sort=-currentUnitCost');
      const byCost = expectList();
      expect(byCost.request.params.get('sort')).toBe('-currentUnitCost');
      byCost.flush(paged([productSummary()]));
      await stable();

      sortButton('name').click();
      await stable();
      expect(url()).toBe('/products?sort=name');
      expectList().flush(paged([productSummary()]));
      await stable();
      expect(header('name').getAttribute('aria-sort')).toBe('ascending');
    });
  });

  describe('rows and states', () => {
    it('shows each product with its current cost, amber "Unknown" for none, and order counts', async () => {
      await render();
      expect(list().dataset['state']).toBe('loading');
      await flushList([
        productSummary(),
        productSummary({
          id: '701',
          sku: 'SAREE-RED',
          name: null,
          catalogId: null,
          status: 'archived',
          orderCount: 4,
          ordersWithoutCost: 0,
          currentCost: null,
          costCount: 0,
        }),
        productSummary({
          id: '702',
          sku: 'FREE-GIFT',
          ordersWithoutCost: 0,
          currentCost: { unitCost: '0.0000', effectiveFrom: '2026-10-20' },
        }),
      ]);

      expect(list().dataset['state']).toBe('ready');
      expect(textOf(host().querySelector('caption'))).toBe('Products of Main store');
      expect(row('700').querySelector('th a')?.getAttribute('href')).toBe('/products/700');
      const cells = (r: Element) => Array.from(r.querySelectorAll('td')).map((td) => textOf(td));
      expect(cells(row('700'))).toEqual([
        'Cotton kurta Catalog CAT-5',
        '₹250.00 since 1 Oct 2026',
        '12',
        '2',
        'Active',
      ]);
      expect(cells(row('701'))).toEqual(['—', 'Unknown No cost entered', '4', '0', 'Archived']);
      // A real zero cost is shown as ₹0.00, not as unknown.
      expect(cells(row('702'))[1]).toBe('₹0.00 since 20 Oct 2026');

      const unknown = row('701').querySelector('[data-testid="product-current-cost"] span');
      expect(unknown?.className).toContain('text-amber-800');
      const withoutCost = row('700').querySelector(
        '[data-testid="product-orders-without-cost"] span',
      );
      expect(withoutCost?.className).toContain('text-amber-800');
      expect(
        row('701').querySelector('[data-testid="product-orders-without-cost"] span')?.className,
      ).not.toContain('amber');
      expect(textOf(host().querySelector('[data-testid="result-announcement"]'))).toBe(
        '3 products found.',
      );
      expect(textOf(host())).toContain('Orders dated before a product’s first cost have an unknown cost, never ₹0.');
    });

    it('says "No cost effective today" when only another date has a cost', async () => {
      await render();
      await flushList([productSummary({ currentCost: null, costCount: 1 })]);
      expect(textOf(row('700').querySelector('[data-testid="product-current-cost"]'))).toBe(
        'Unknown No cost effective today',
      );
    });

    it('shows an error with "Try again"', async () => {
      await render();
      expectList().flush(errorBody('INTERNAL_ERROR', 'Boom.'), {
        status: 500,
        statusText: 'Server Error',
      });
      await stable();
      const paragraphs = Array.from(list().querySelectorAll('[role="alert"] p')).map((p) =>
        textOf(p),
      );
      expect(paragraphs).toEqual(['The products could not be loaded.', 'Boom. (request ID req-1)']);
      buttonByText('Try again', list())?.click();
      await stable();
      await flushList();
      expect(rows()).toHaveLength(1);
    });

    it('shows an empty state without filters and "no results" with filters', async () => {
      await render();
      await flushList([]);
      expect(host().querySelector('[data-testid="no-products"]')).not.toBeNull();
      expect(host().querySelector('a[href="/imports"]')).not.toBeNull();

      await harness.navigateByUrl('/products?cost=missing');
      expectList().flush(paged([]));
      await stable();
      expect(host().querySelector('[data-testid="no-results"]')).not.toBeNull();
      buttonByText('Clear filters', list())?.click();
      await stable();
      expect(url()).toBe('/products');
      expectList().flush(paged([productSummary()]));
      await stable();
    });
  });

  describe('sync from orders', () => {
    it('POSTs the sync, announces the counts and reloads the list (members can sync)', async () => {
      await render('/products', ME_MEMBER);
      await flushList();

      buttonByText('Sync from orders')?.click();
      await stable();
      expect(buttonByText('Syncing…')?.getAttribute('aria-disabled')).toBe('true');
      const sync = httpTesting.expectOne({
        method: 'POST',
        url: '/api/v1/accounts/100/products/sync',
      });
      sync.flush({ createdProducts: 3, linkedOrders: 12 });
      await stable();

      expect(notice()).toBe('Sync finished: 3 products created and 12 orders linked.');
      await flushList([productSummary(), productSummary({ id: '701', sku: 'NEW' })]);
      expect(rows()).toHaveLength(2);
    });

    it('says when everything was already in sync', () => {
      expect(describeSyncResult({ createdProducts: 0, linkedOrders: 0 })).toBe(
        'Already up to date: every SKU in your imported orders has a product, and every order is linked.',
      );
      expect(describeSyncResult({ createdProducts: 1, linkedOrders: 0 })).toBe(
        'Sync finished: 1 product created and 0 orders linked.',
      );
    });

    it('shows a failed sync as an alert and keeps the list', async () => {
      await render();
      await flushList();
      buttonByText('Sync from orders')?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/products/sync')
        .flush(errorBody('NOT_FOUND', 'Seller account not found.'), {
          status: 404,
          statusText: 'Not Found',
        });
      await stable();
      const alert = host().querySelector('[data-testid="sync-error"]') as HTMLElement;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(Array.from(alert.querySelectorAll('p')).map((p) => textOf(p))).toEqual([
        'The products could not be synced.',
        'Seller account not found.',
      ]);
      expect(rows()).toHaveLength(1);
    });
  });

  describe('add product', () => {
    it('validates, POSTs the trimmed values and links to the new product', async () => {
      await render();
      await flushList();

      const addButton = buttonByText('Add product') as HTMLButtonElement;
      addButton.click();
      await stable();
      expect(dialog()).not.toBeNull();
      expect(document.activeElement).toBe(dialogInput('sku'));

      // Empty SKU: error linked to the field, focus stays on it.
      buttonByText('Add product', dialog() as HTMLElement)?.click();
      await stable();
      const sku = dialogInput('sku');
      expect(sku.getAttribute('aria-invalid')).toBe('true');
      const errorId = (sku.getAttribute('aria-describedby') as string).split(' ')[1];
      expect(textOf(host().querySelector(`#${errorId}`))).toBe('Enter the SKU.');
      expect(document.activeElement).toBe(sku);

      typeInto(sku, '  NEW-1 ');
      typeInto(dialogInput('name'), ' New thing ');
      await stable();
      buttonByText('Add product', dialog() as HTMLElement)?.click();
      await stable();
      const req = httpTesting.expectOne({ method: 'POST', url: '/api/v1/accounts/100/products' });
      expect(req.request.body).toEqual({ sku: 'NEW-1', name: 'New thing' });
      req.flush(productDetail({ id: '703', sku: 'NEW-1' }), { status: 201, statusText: 'Created' });
      await stable();

      expect(dialog()).toBeNull();
      expect(notice()).toBe('Added product NEW-1. Open it to enter its unit cost. Open the product');
      expect(
        host().querySelector('[data-testid="products-notice"] a')?.getAttribute('href'),
      ).toBe('/products/703');
      await flushList();
    });

    it('shows a 409 naming sku (SKU already has a product) under the SKU and keeps the dialog open', async () => {
      await render();
      await flushList();
      buttonByText('Add product')?.click();
      await stable();
      typeInto(dialogInput('sku'), 'KURTA-M');
      await stable();
      buttonByText('Add product', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/products')
        .flush(
          errorBody('CONFLICT', 'A product with this SKU already exists.', [
            { field: 'sku', reasons: ['already has a product in this seller account'] },
          ]),
          { status: 409, statusText: 'Conflict' },
        );
      await stable();

      expect(dialog()).not.toBeNull();
      const sku = dialogInput('sku');
      expect(sku.getAttribute('aria-invalid')).toBe('true');
      const errorId = (sku.getAttribute('aria-describedby') as string).split(' ')[1];
      expect(textOf(host().querySelector(`#${errorId}`))).toBe(
        'already has a product in this seller account',
      );
      expect(document.activeElement).toBe(sku);
      expect(dialog()?.querySelector('[role="alert"]')).toBeNull();

      // Cancel closes it without a request.
      buttonByText('Cancel', dialog() as HTMLElement)?.click();
      await stable();
      expect(dialog()).toBeNull();
    });

    it('shows a 409 without field details (e.g. account busy) above the form, not under the SKU', async () => {
      await render();
      await flushList();
      buttonByText('Add product')?.click();
      await stable();
      typeInto(dialogInput('sku'), 'NEW-2');
      await stable();
      buttonByText('Add product', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/products')
        .flush(errorBody('CONFLICT', 'An import is running for this account. Try again shortly.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();
      const alert = dialog()?.querySelector('[role="alert"]') as HTMLElement;
      expect(textOf(alert)).toBe('An import is running for this account. Try again shortly.');
      expect(document.activeElement).toBe(alert);
      expect(dialogInput('sku').hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows the API’s field reasons under the field it names', async () => {
      await render();
      await flushList();
      buttonByText('Add product')?.click();
      await stable();
      typeInto(dialogInput('sku'), 'X');
      typeInto(dialogInput('catalogId'), 'C');
      await stable();
      buttonByText('Add product', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/products')
        .flush(
          errorBody('VALIDATION_ERROR', 'Invalid body.', [
            { field: 'catalogId', reasons: ['must be digits'] },
          ]),
          { status: 400, statusText: 'Bad Request' },
        );
      await stable();
      expect(dialogInput('catalogId').getAttribute('aria-invalid')).toBe('true');
      expect(textOf(dialog())).toContain('must be digits');
      expect(document.activeElement).toBe(dialogInput('catalogId'));
    });
  });
});
