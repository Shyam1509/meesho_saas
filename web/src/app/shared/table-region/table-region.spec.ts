import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { orderSummary } from '../../../testing/test-data';
import { OrdersTable } from '../../features/orders/orders-table/orders-table';
import { TableRegion } from './table-region';

@Component({
  imports: [TableRegion, OrdersTable],
  template: `
    <div [appTableRegion]="name()" class="overflow-x-auto">
      <table>
        <caption>
          {{ name() }}
        </caption>
      </table>
    </div>
    <app-orders-table [orders]="orders" accountId="100" caption="Orders of Main store" />
  `,
})
class Host {
  readonly name = signal('Products of Main store');
  readonly orders = [orderSummary()];
}

/** Stands in for the browser's ResizeObserver (jsdom has none). */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Simulates a resize of what it watches. */
  fire(): void {
    this.callback();
  }
}

/** Gives the element the scroll and client widths a browser would measure. */
function setWidths(element: Element, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
}

describe('TableRegion', () => {
  let fixture: ComponentFixture<Host>;
  const regions = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-table-region]'));
  const observerOf = (element: Element) =>
    FakeResizeObserver.instances.find((o) => o.targets[0] === element) as FakeResizeObserver;

  beforeEach(async () => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('a table that fits adds no Tab stop and no region, but keeps its name', () => {
    const region = regions()[0];
    expect(region.hasAttribute('role')).toBe(false);
    expect(region.hasAttribute('tabindex')).toBe(false);
    expect(region.getAttribute('aria-label')).toBe('Products of Main store (scrollable table)');
  });

  it('a table wider than its container makes it a named region keyboard users can Tab to', async () => {
    const region = regions()[0];
    setWidths(region, 900, 328);
    observerOf(region).fire();
    await fixture.whenStable();

    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('data-scrollable')).toBe('true');

    // The window grows until the table fits: back to a plain wrapper.
    setWidths(region, 1000, 1000);
    observerOf(region).fire();
    await fixture.whenStable();
    expect(region.hasAttribute('role')).toBe(false);
    expect(region.hasAttribute('tabindex')).toBe(false);
    expect(region.getAttribute('aria-label')).toBe('Products of Main store (scrollable table)');
  });

  it('re-checks when the element or its table changes size, and stops on destroy', () => {
    const region = regions()[0];
    const observer = observerOf(region);
    expect(observer.targets).toEqual([region, region.querySelector('table')]);

    fixture.destroy();
    expect(observer.disconnected).toBe(true);
  });

  it('names the region apart from the section around it (unique landmark names)', async () => {
    const region = regions()[0];
    const caption = region.querySelector('caption')?.textContent?.trim() ?? '';
    expect(region.getAttribute('aria-label')).not.toBe(caption);
    expect(region.getAttribute('aria-label')).toContain(caption);

    fixture.componentInstance.name.set('Products of Second store');
    await fixture.whenStable();
    expect(region.getAttribute('aria-label')).toBe('Products of Second store (scrollable table)');
  });

  it('is positioned, so hidden cell text scrolls with the table instead of widening the page', () => {
    for (const region of regions()) {
      // `sr-only` text is absolutely positioned: without a positioned scroll container it escapes
      // the overflow and adds to the page's width on a phone.
      expect(region.classList).toContain('relative');
    }
    // The element's own classes are kept.
    expect(regions()[0].classList).toContain('overflow-x-auto');
  });

  it('wraps the shared tables, named after their caption', async () => {
    const ordersRegion = regions()[1];
    expect(ordersRegion.getAttribute('aria-label')).toBe('Orders of Main store (scrollable table)');
    expect(ordersRegion.querySelector('[data-testid="orders-table"]')).not.toBeNull();

    setWidths(ordersRegion, 1100, 328);
    observerOf(ordersRegion).fire();
    await fixture.whenStable();
    expect(ordersRegion.getAttribute('role')).toBe('region');
    expect(ordersRegion.getAttribute('tabindex')).toBe('0');
  });
});
