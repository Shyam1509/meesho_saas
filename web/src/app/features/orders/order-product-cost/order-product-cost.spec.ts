import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { textOf } from '../../../../testing/test-data';
import { OrderProductCost } from '../../../core/orders/order.models';
import { OrderProductCostView } from './order-product-cost';

describe('OrderProductCostView', () => {
  let fixture: ComponentFixture<OrderProductCostView>;
  const host = () => fixture.nativeElement as HTMLElement;

  async function render(
    cost: OrderProductCost | null | undefined,
    quantity: number | null = 2,
    productId: string | null = '700',
    detailed = false,
    sku: string | null = null,
  ): Promise<void> {
    fixture = TestBed.createComponent(OrderProductCostView);
    fixture.componentRef.setInput('cost', cost);
    fixture.componentRef.setInput('quantity', quantity);
    fixture.componentRef.setInput('productId', productId);
    fixture.componentRef.setInput('detailed', detailed);
    fixture.componentRef.setInput('sku', sku);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('known: shows the total (2 decimals) and "qty × unit from date"', async () => {
    await render({
      state: 'known',
      unitCost: '12.3456',
      effectiveFrom: '2026-10-01',
      total: '24.6912',
    });
    expect(host().getAttribute('data-cost-state')).toBe('known');
    expect(textOf(host())).toBe('₹24.69 2 × ₹12.3456 from 1 Oct 2026');
  });

  it('known with a real zero cost shows ₹0.00 (zero is not missing)', async () => {
    await render({ state: 'known', unitCost: '0.0000', effectiveFrom: '2026-10-01', total: '0.0000' }, 3);
    expect(textOf(host())).toBe('₹0.00 3 × ₹0.00 from 1 Oct 2026');
  });

  it('known without a quantity shows "—" and the unit cost per unit', async () => {
    await render(
      { state: 'known', unitCost: '250.0000', effectiveFrom: '2026-10-01', total: null },
      null,
    );
    expect(textOf(host())).toBe('— not available ₹250.00 per unit from 1 Oct 2026');
    expect(textOf(host())).not.toContain('₹0.00');
  });

  it('unknown: amber "Unknown cost" linking to the product, never ₹0', async () => {
    await render({ state: 'unknown', unitCost: null, effectiveFrom: null, total: null });
    const link = host().querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/products/700');
    expect(link.className).toContain('text-amber-800');
    expect(textOf(link)).toBe('Unknown cost: add a unit cost for this product');
    expect(textOf(host())).not.toContain('₹');
  });

  it('unknown without a product id is plain text; detailed mode explains it', async () => {
    await render({ state: 'unknown', unitCost: null, effectiveFrom: null, total: null }, 1, null, true);
    expect(host().querySelector('a')).toBeNull();
    expect(textOf(host())).toBe(
      'Unknown cost No unit cost is effective on the order date, so this order’s cost is unknown (not ₹0).',
    );
  });

  it('no_product without a SKU: "No SKU"', async () => {
    await render({ state: 'no_product', unitCost: null, effectiveFrom: null, total: null }, 1, null);
    expect(host().getAttribute('data-cost-state')).toBe('no_product');
    expect(textOf(host())).toBe('No SKU');
    expect(host().querySelector('a')).toBeNull();
  });

  it('no_product WITH a SKU: "No product yet" linking to Products & costs, hint "Sync from orders"', async () => {
    const noProduct: OrderProductCost = {
      state: 'no_product',
      unitCost: null,
      effectiveFrom: null,
      total: null,
    };
    await render(noProduct, 1, null, false, 'KURTA-M');
    const link = host().querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/products');
    expect(textOf(link)).toBe('No product yet: open Products & costs');
    expect(link.className).toContain('text-amber-800');
    expect(textOf(host())).toBe('No product yet: open Products & costs Use “Sync from orders”');
    expect(textOf(host())).not.toContain('No SKU');
    expect(textOf(host())).not.toContain('₹0.00');

    await render(noProduct, 1, null, false, '   ');
    expect(textOf(host())).toBe('No SKU');
  });

  it('a missing productCost (older API data) shows "—", not ₹0.00', async () => {
    await render(undefined);
    expect(host().getAttribute('data-cost-state')).toBeNull();
    expect(textOf(host())).toBe('— not available');
  });
});
