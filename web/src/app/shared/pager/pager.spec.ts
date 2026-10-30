import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { Pager } from './pager';

@Component({
  imports: [Pager],
  template: `
    <app-pager
      [page]="page()"
      [pageSize]="20"
      [total]="total()"
      [busy]="busy()"
      label="Test pages"
      itemLabel="imports"
      (pageChange)="changes.push($event)"
    />
  `,
})
class Host {
  readonly page = signal(1);
  readonly total = signal(45);
  readonly busy = signal(false);
  readonly changes: number[] = [];
}

describe('Pager', () => {
  let fixture: ComponentFixture<Host>;
  const nav = () => fixture.nativeElement.querySelector('nav') as HTMLElement;
  const button = (label: string) =>
    Array.from(nav().querySelectorAll('button')).find((b) => textOf(b) === label) as
      | HTMLButtonElement
      | undefined;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is a named navigation landmark with the visible range', () => {
    expect(nav().getAttribute('aria-label')).toBe('Test pages');
    expect(textOf(nav())).toContain('Showing 1–20 of 45 imports');
    expect(textOf(nav())).toContain('Page 1 of 3');
  });

  it('emits the next and previous page, never past either end', async () => {
    button('Previous page')?.click();
    button('Next page')?.click();
    expect(fixture.componentInstance.changes).toEqual([2]);

    fixture.componentInstance.page.set(3);
    await fixture.whenStable();
    expect(textOf(nav())).toContain('Showing 41–45 of 45 imports');
    expect(button('Next page')?.getAttribute('aria-disabled')).toBe('true');
    button('Next page')?.click();
    button('Previous page')?.click();
    expect(fixture.componentInstance.changes).toEqual([2, 2]);
  });

  it('does nothing while busy', async () => {
    fixture.componentInstance.busy.set(true);
    await fixture.whenStable();
    expect(button('Next page')?.getAttribute('aria-disabled')).toBe('true');
    button('Next page')?.click();
    expect(fixture.componentInstance.changes).toEqual([]);
  });

  it('hides the buttons for a single page and says when there is nothing', async () => {
    fixture.componentInstance.total.set(7);
    await fixture.whenStable();
    expect(textOf(nav())).toBe('Showing 1–7 of 7 imports');
    expect(nav().querySelectorAll('button')).toHaveLength(0);

    fixture.componentInstance.total.set(0);
    await fixture.whenStable();
    expect(textOf(nav())).toBe('No imports');
  });
});
