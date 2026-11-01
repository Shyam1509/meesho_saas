import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { FilterBar } from './filter-bar';

@Component({
  imports: [FilterBar],
  template: `
    <app-filter-bar
      label="Filter orders"
      [active]="active()"
      (applied)="applied = applied + 1"
      (cleared)="cleared = cleared + 1"
    >
      <div id="field">
        <label for="q">Search</label>
        <input id="q" type="search" />
      </div>
    </app-filter-bar>
  `,
})
class Host {
  readonly active = signal(false);
  applied = 0;
  cleared = 0;
}

describe('FilterBar', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const form = () => el().querySelector('form') as HTMLFormElement;
  const buttons = () => Array.from(form().querySelectorAll('button')).map((b) => textOf(b));

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is a named search landmark; "Apply filters" (or Enter) emits applied', () => {
    expect(form().getAttribute('role')).toBe('search');
    expect(form().getAttribute('aria-label')).toBe('Filter orders');
    expect(buttons()).toEqual(['Apply filters']);

    form().dispatchEvent(new Event('submit', { cancelable: true }));
    expect(fixture.componentInstance.applied).toBe(1);
  });

  it('offers "Clear filters" only while a filter is applied', async () => {
    fixture.componentInstance.active.set(true);
    await fixture.whenStable();
    expect(buttons()).toEqual(['Apply filters', 'Clear filters']);

    (form().querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(fixture.componentInstance.cleared).toBe(1);
    expect(fixture.componentInstance.applied).toBe(0);
  });

  it('wraps its fields and keeps each at most the bar’s width (no sideways page scroll)', () => {
    const row = el().querySelector('#field')?.parentElement as HTMLElement;
    expect(row.classList).toContain('flex-wrap');
    // A select's longest option must not make a field wider than a 360px screen.
    expect(row.classList).toContain('*:max-w-full');
  });
});
