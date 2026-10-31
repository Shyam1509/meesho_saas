import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ME_OWNER } from '../../../testing/test-data';
import { routes } from '../../app.routes';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
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

  // These screens sit inside the app shell, which needs a signed-in user. Seller accounts and
  // Workspace settings are real pages since Milestone 3, Imports since Milestone 4, Orders and
  // Settlements & reconciliation since Milestone 5 (see app.spec.ts and their own specs).
  describe('through the router', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          provideApiHttpClient(),
          provideHttpClientTesting(),
          { provide: TitleStrategy, useClass: AppTitleStrategy },
        ],
      });
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
    });

    it.each([
      ['/products', 'Products & costs', 'Milestone 6'],
      ['/expenses', 'Expenses', 'Milestone 6'],
      ['/reports', 'Reports', 'Milestone 7'],
    ])('%s shows "%s" planned in %s and sets the page title', async (url, heading, milestone) => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);

      const el = harness.routeNativeElement as HTMLElement;
      expect(el.querySelector('app-placeholder-page h1')?.textContent?.trim()).toBe(heading);
      expect(el.textContent).toContain(`Not built yet — planned in ${milestone}.`);
      expect(document.title).toBe(`${heading} · Meesho Seller SaaS`);
    });
  });
});
