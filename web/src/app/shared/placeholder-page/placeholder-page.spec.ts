import { TestBed } from '@angular/core/testing';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { AppTitleStrategy } from '../../core/title/app-title-strategy';
import { PlaceholderPage, formatMilestones } from './placeholder-page';

describe('PlaceholderPage', () => {
  it('shows the heading and milestone text from its inputs', async () => {
    const fixture = TestBed.createComponent(PlaceholderPage);
    fixture.componentRef.setInput('heading', 'Imports');
    fixture.componentRef.setInput('milestones', [4]);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Imports');
    expect(el.textContent).toContain('Not built yet — planned in Milestone 4.');
  });

  it('formats one or several milestones', () => {
    expect(formatMilestones([5])).toBe('Milestone 5');
    expect(formatMilestones([2, 3])).toBe('Milestones 2 and 3');
  });

  describe('through the router', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          { provide: TitleStrategy, useClass: AppTitleStrategy },
        ],
      });
    });

    it.each([
      ['/orders', 'Orders', 'Milestone 5'],
      ['/settlements', 'Settlements & reconciliation', 'Milestone 5'],
      ['/products', 'Products & costs', 'Milestone 6'],
      ['/expenses', 'Expenses', 'Milestone 6'],
      ['/imports', 'Imports', 'Milestone 4'],
      ['/reports', 'Reports', 'Milestone 7'],
      ['/seller-accounts', 'Seller accounts', 'Milestones 2 and 3'],
      ['/settings', 'Workspace settings', 'Milestone 3'],
    ])('%s shows "%s" planned in %s and sets the page title', async (url, heading, milestone) => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url, PlaceholderPage);

      const el = harness.routeNativeElement as HTMLElement;
      expect(el.querySelector('h1')?.textContent?.trim()).toBe(heading);
      expect(el.textContent).toContain(`Not built yet — planned in ${milestone}.`);
      expect(document.title).toBe(`${heading} · Meesho Seller SaaS`);
    });
  });
});
