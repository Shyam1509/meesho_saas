import { TestBed } from '@angular/core/testing';
import { Route, Routes } from '@angular/router';

import { routes } from '../../app.routes';
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

  // Every screen is a real page since Milestone 7 (Reports was the last placeholder; see
  // app.spec.ts and each page's own spec). The page stays for screens added later.
  it('is not used by any route any more (no route carries placeholder milestones)', () => {
    const all = (list: Routes): Route[] => list.flatMap((r) => [r, ...all(r.children ?? [])]);
    const placeholders = all(routes).filter((r) => r.data?.['milestones'] !== undefined);
    expect(placeholders.map((r) => r.path)).toEqual([]);
    expect(all(routes).find((r) => r.path === 'reports')?.title).toBe('Reports');
  });
});
