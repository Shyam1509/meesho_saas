import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { EmptyState } from './empty-state';

@Component({
  imports: [EmptyState],
  template: `
    <app-empty-state heading="No orders match these filters." data-testid="no-results">
      Change or clear the filters to see more orders.
      @if (withAction()) {
        <button emptyStateAction type="button" (click)="cleared = cleared + 1">
          Clear filters
        </button>
      }
    </app-empty-state>
  `,
})
class Host {
  readonly withAction = signal(true);
  cleared = 0;
}

describe('EmptyState', () => {
  let fixture: ComponentFixture<Host>;
  const box = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="no-results"]') as HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('shows the heading, then the explanation, then the action', () => {
    const paragraphs = Array.from(box().querySelectorAll('p')).map((p) => textOf(p));
    expect(paragraphs).toEqual([
      'No orders match these filters.',
      'Change or clear the filters to see more orders.',
    ]);
    const button = box().querySelector('button') as HTMLButtonElement;
    expect(textOf(button)).toBe('Clear filters');
    // The action sits after the text, outside its paragraph.
    expect(button.closest('p')).toBeNull();
    button.click();
    expect(fixture.componentInstance.cleared).toBe(1);
  });

  it('works without an action', async () => {
    fixture.componentInstance.withAction.set(false);
    await fixture.whenStable();
    expect(box().querySelector('button')).toBeNull();
    expect(textOf(box())).toBe(
      'No orders match these filters. Change or clear the filters to see more orders.',
    );
  });
});
