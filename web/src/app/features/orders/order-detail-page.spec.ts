import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  errorBody,
  importRef,
  orderDetail,
  settlementEntry,
  statusEvent,
  textOf,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { OrderDetail } from '../../core/orders/order.models';
import { OrderDetailPage, sortStatusHistory } from './order-detail-page';

describe('OrderDetailPage', () => {
  let fixture: ComponentFixture<OrderDetailPage>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const state = () => (host().querySelector('[data-state]') as HTMLElement).dataset['state'];
  const stable = () => fixture.whenStable();
  const field = (label: string) => {
    const dt = Array.from(host().querySelectorAll('[data-testid="order-fields"] dt')).find(
      (d) => textOf(d) === label,
    );
    return dt?.nextElementSibling as HTMLElement;
  };
  const historyItems = () =>
    Array.from(host().querySelectorAll('[data-testid="status-history"] li'));

  async function render(order: OrderDetail | null, accountId = '100', orderId = '9001') {
    fixture = TestBed.createComponent(OrderDetailPage);
    fixture.componentRef.setInput('accountId', accountId);
    fixture.componentRef.setInput('orderId', orderId);
    await stable();
    if (order) {
      httpTesting.expectOne(`/api/v1/accounts/${accountId}/orders/${orderId}`).flush(order);
      await stable();
    }
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('shows loading, then the order’s fields ("—" for missing) and source imports', async () => {
    fixture = TestBed.createComponent(OrderDetailPage);
    fixture.componentRef.setInput('accountId', '100');
    fixture.componentRef.setInput('orderId', '9001');
    await stable();
    expect(state()).toBe('loading');
    expect(textOf(host().querySelector('h1'))).toBe('Order details');

    httpTesting.expectOne('/api/v1/accounts/100/orders/9001').flush(orderDetail());
    await stable();

    expect(state()).toBe('ready');
    expect(textOf(host().querySelector('h1'))).toBe('Order SO-1001');
    expect(textOf(field('Sub order no.'))).toBe('SO-1001');
    expect(textOf(field('Order no.'))).toBe('ORD-77');
    expect(textOf(field('Order date'))).toBe('5 Oct 2026');
    expect(textOf(field('Current status'))).toMatch(/^Delivered as of \d{1,2} Oct 2026, /);
    expect(textOf(field('Product'))).toBe('Cotton kurta');
    expect(textOf(field('Quantity'))).toBe('1');
    expect(textOf(field('Catalog ID'))).toBe('CAT-5');
    expect(textOf(field('Packet ID'))).toBe('—');
    expect(textOf(field('Supplier listed price'))).toBe('₹1,249.50');
    expect(textOf(field('Supplier discounted price'))).toBe('₹1,199.00');
    expect(textOf(field('Product cost'))).toBe(
      '₹250.00 1 × ₹250.00 from 1 Oct 2026 View product and unit costs',
    );
    expect(field('Product cost').querySelector('a')?.getAttribute('href')).toBe('/products/700');
    expect(field('First imported from').querySelector('a')?.getAttribute('href')).toBe(
      '/imports/480',
    );
    expect(field('Last updated by').querySelector('a')?.getAttribute('href')).toBe('/imports/500');
    expect(host().querySelector('a[href="/orders"]')?.textContent).toContain('All orders');
  });

  describe('product cost', () => {
    it('explains an unknown cost and links to the product, never showing ₹0', async () => {
      await render(
        orderDetail({
          productCost: { state: 'unknown', unitCost: null, effectiveFrom: null, total: null },
        }),
      );
      const cost = field('Product cost');
      expect(textOf(cost)).toBe(
        'Unknown cost: add a unit cost for this product No unit cost is effective on the order date, so this order’s cost is unknown (not ₹0). View product and unit costs',
      );
      expect(cost.querySelector('[data-cost-state]')?.getAttribute('data-cost-state')).toBe(
        'unknown',
      );
      expect(textOf(cost)).not.toContain('₹0.00');
    });

    it('says "No product yet" for an order whose SKU has no product yet', async () => {
      await render(
        orderDetail({
          sku: 'OLD-SKU',
          productId: null,
          productCost: { state: 'no_product', unitCost: null, effectiveFrom: null, total: null },
        }),
      );
      const cost = field('Product cost');
      expect(textOf(cost)).toBe(
        'No product yet: open Products & costs Use “Sync from orders” No product exists for this SKU yet, so the cost is unknown (not ₹0). “Sync from orders” on Products & costs creates it.',
      );
      expect(cost.querySelector('a')?.getAttribute('href')).toBe('/products');
      expect(textOf(cost)).not.toContain('has no SKU');
    });

    it('says "No SKU" for an order without a SKU', async () => {
      await render(
        orderDetail({
          sku: null,
          productId: null,
          productCost: { state: 'no_product', unitCost: null, effectiveFrom: null, total: null },
        }),
      );
      expect(textOf(field('Product cost'))).toBe(
        'No SKU The order has no SKU, so it has no product and no cost.',
      );
      expect(field('Product cost').querySelector('a')).toBeNull();
    });
  });

  describe('status history', () => {
    it('lists statuses oldest first (time, then id) with the import each came from', async () => {
      // The API already sends this order; the page keeps it even if it did not.
      const shuffled = [
        statusEvent({ id: '12', status: 'Delivered', observedAt: '2026-10-29T18:29:59.999Z' }),
        statusEvent({ id: '10', status: 'Shipped', observedAt: '2026-10-10T18:29:59.999Z' }),
        statusEvent({
          id: '9',
          status: 'Ready to ship',
          observedAt: '2026-10-10T18:29:59.999Z',
          importJob: importRef({ id: '470', originalFilename: 'orders-1.csv' }),
        }),
      ];
      await render(orderDetail({ statusHistory: shuffled }));

      expect(historyItems().map((li) => li.getAttribute('data-event-id'))).toEqual([
        '9',
        '10',
        '12',
      ]);
      const first = historyItems()[0];
      expect(textOf(first)).toMatch(/^Ready to ship \d{1,2} Oct 2026, .* · from orders-1\.csv$/);
      expect(first.querySelector('a')?.getAttribute('href')).toBe('/imports/470');
      expect(first.querySelector('time')?.getAttribute('datetime')).toBe(
        '2026-10-10T18:29:59.999Z',
      );
      expect(textOf(historyItems()[2])).toContain('Delivered (current)');
      expect(textOf(historyItems()[0])).not.toContain('(current)');
    });

    it('sortStatusHistory compares ids as numbers on a tie', () => {
      const at = '2026-10-10T00:00:00.000Z';
      const ids = sortStatusHistory([
        statusEvent({ id: '100', observedAt: at }),
        statusEvent({ id: '20', observedAt: at }),
        statusEvent({ id: '3', observedAt: '2026-10-11T00:00:00.000Z' }),
      ]).map((e) => e.id);
      expect(ids).toEqual(['20', '100', '3']);
    });

    it('says so when there is no history', async () => {
      await render(orderDetail({ statusHistory: [] }));
      expect(textOf(host().querySelector('[data-testid="no-history"]'))).toBe(
        'No status history was saved for this order.',
      );
    });
  });

  describe('settlements', () => {
    it('shows the server’s "Settled (as reported)" and the matched entries without self-links', async () => {
      await render(
        orderDetail({
          settlement: { entryCount: 2, amount: '1030.40' },
          settlements: [
            settlementEntry(),
            settlementEntry({
              id: '3005',
              transactionId: 'TXN-5',
              entryType: 'recovery',
              settlementAmount: '-150.00',
              saleAmount: null,
              match: { ...settlementEntry().match, method: 'manual', matchedBy: { id: '1', displayName: 'Asha Rao', email: 'asha@example.com' } },
            }),
          ],
        }),
      );
      const summary = host().querySelector('[data-testid="settled-summary"]') as HTMLElement;
      expect(textOf(summary)).toBe(
        'Settled (as reported) ₹1,030.40 Sum of the settlement amount of 2 matched entries.',
      );
      expect(textOf(host())).toContain('Amounts are as reported by Meesho — not profit.');

      const rows = Array.from(host().querySelectorAll('[data-testid="entries-table"] tbody tr'));
      expect(rows.map((r) => r.getAttribute('data-entry-id'))).toEqual(['3001', '3005']);
      const amount = (row: Element, column: string) =>
        textOf(row.querySelector(`[data-column="${column}"]`));
      expect(amount(rows[0], 'settlementAmount')).toBe('₹1,180.40');
      expect(amount(rows[0], 'tcsAmount')).toBe('-₹5.00');
      expect(amount(rows[0], 'tdsAmount')).toBe('-₹1.00');
      expect(amount(rows[0], 'shippingCharge')).toBe('₹0.00');
      expect(amount(rows[0], 'returnAmount')).toBe('— not reported');
      expect(amount(rows[1], 'settlementAmount')).toBe('-₹150.00');
      expect(textOf(rows[1].querySelector('[data-column="match"]'))).toMatch(
        /^Matched \(manual\) by Asha Rao, /,
      );
      // On the order's own page the entries do not link back to it.
      expect(host().querySelector('[data-testid="entries-table"] a[href^="/accounts/"]')).toBeNull();
      expect(rows[0].querySelector('a[href="/imports/510"]')).not.toBeNull();
    });

    it('says no settlement is matched (not ₹0) when there is none', async () => {
      await render(orderDetail({ settlement: { entryCount: 0, amount: null }, settlements: [] }));
      const summary = Array.from(
        host().querySelectorAll('[data-testid="settled-summary"] p'),
      ).map((p) => textOf(p));
      expect(summary).toEqual(['Settled (as reported)', 'No settlement matched yet']);
      expect(textOf(host().querySelector('[data-testid="no-settlements"]'))).toBe(
        'No settlement entries are matched to this order yet.',
      );
      expect(host().querySelector('[data-testid="entries-table"]')).toBeNull();
    });
  });

  describe('not found and errors', () => {
    it.each([
      ['abc', '9001'],
      ['100', '0'],
      ['100', '12x'],
    ])('a malformed id (%s / %s) is not found without asking the API', async (accountId, orderId) => {
      await render(null, accountId, orderId);
      expect(state()).toBe('not-found');
      expect(textOf(host().querySelector('[role="alert"]'))).toContain('This order was not found.');
    });

    it.each([404, 400])('a %s is not found', async (status) => {
      await render(null);
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/9001')
        .flush(errorBody('NOT_FOUND', 'Order not found.'), { status, statusText: 'Error' });
      await stable();
      expect(state()).toBe('not-found');
      expect(textOf(host().querySelector('h1'))).toBe('Order details');
    });

    it('shows other errors with "Try again"', async () => {
      await render(null);
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/9001')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await stable();
      expect(state()).toBe('error');
      expect(textOf(host().querySelector('[role="alert"]'))).toContain('Boom. (request ID req-1)');

      (host().querySelector('[role="alert"] button') as HTMLButtonElement).click();
      await stable();
      httpTesting.expectOne('/api/v1/accounts/100/orders/9001').flush(orderDetail());
      await stable();
      expect(state()).toBe('ready');
    });

    it('loads another order when the route changes', async () => {
      await render(orderDetail());
      fixture.componentRef.setInput('orderId', '9002');
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/orders/9002')
        .flush(orderDetail({ id: '9002', subOrderNo: 'SO-1002' }));
      await stable();
      expect(textOf(host().querySelector('h1'))).toBe('Order SO-1002');
    });
  });
});
