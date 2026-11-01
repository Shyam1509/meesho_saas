import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { RouteFocus } from './route-focus';

@Component({
  template: `<main><h1>Orders</h1><button id="apply" type="button">Apply filters</button></main>`,
})
class OrdersPage {}

@Component({ template: `<main><h1 tabindex="-1">Reports</h1></main>` })
class ReportsPage {}

@Component({ template: `<main>Nothing here has a heading.</main>` })
class HeadinglessPage {}

describe('RouteFocus', () => {
  let harness: RouterTestingHarness;
  const announced = () =>
    document.body.querySelector('[data-live-announcer]')?.textContent ?? '';
  const h1 = () => document.querySelector('main h1') as HTMLElement | null;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'orders', title: 'Orders', component: OrdersPage },
          { path: 'reports', title: 'Reports', component: ReportsPage },
          { path: 'blank', title: 'Blank page', component: HeadinglessPage },
        ]),
      ],
    });
    TestBed.inject(RouteFocus).start();
    harness = await RouterTestingHarness.create('/orders');
    await harness.fixture.whenStable();
  });

  it('leaves the first page of a visit alone, with the live region already in place', () => {
    expect(document.activeElement).toBe(document.body);
    // Created at start, before any message, so the first announcement is not missed.
    expect(document.body.querySelector('[data-live-announcer]')).not.toBeNull();
    expect(announced()).toBe('');
  });

  it('moves focus to the new page’s h1 (focusable by script only), without announcing it twice', async () => {
    await harness.navigateByUrl('/reports');
    await harness.fixture.whenStable();
    await vi.waitFor(() => expect(document.activeElement).toBe(h1()));
    expect(textOfActive()).toBe('Reports');

    await harness.navigateByUrl('/orders');
    await harness.fixture.whenStable();
    await vi.waitFor(() => expect(textOfActive()).toBe('Orders'));
    // It was not focusable before: now it is, by script, but it is no Tab stop.
    expect(h1()?.getAttribute('tabindex')).toBe('-1');
    // The focused heading is read out; the live region stays quiet.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announced()).toBe('');
  });

  it('keeps focus where it is when only the query changes (filters, paging, tabs)', async () => {
    const apply = document.querySelector('#apply') as HTMLButtonElement;
    apply.focus();

    await harness.navigateByUrl('/orders?status=Delivered&page=2');
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(document.activeElement).toBe(apply);
    expect(announced()).toBe('');
  });

  it('focuses <main> and announces the title when the page has no h1', async () => {
    await harness.navigateByUrl('/blank');
    await harness.fixture.whenStable();
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('MAIN'));
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    await vi.waitFor(() => expect(announced()).toBe('Blank page'));
  });

  function textOfActive(): string {
    return document.activeElement?.textContent?.trim() ?? '';
  }
});
