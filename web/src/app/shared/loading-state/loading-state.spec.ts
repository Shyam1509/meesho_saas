import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { LoadingState } from './loading-state';

@Component({
  imports: [LoadingState],
  template: `<app-loading-state class="mt-3" text="Loading orders…" />`,
})
class Host {}

describe('LoadingState', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is a polite status message whose text alone carries the meaning', () => {
    const status = el().querySelector('[role="status"]');
    expect(textOf(status)).toBe('Loading orders…');
    expect(el().querySelector('app-loading-state')?.classList).toContain('mt-3');
  });

  it('shows a decorative spinner that only turns when motion is allowed', () => {
    const spinner = el().querySelector('[data-spinner]') as SVGElement;
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    const classes = spinner.getAttribute('class')?.split(/\s+/) ?? [];
    expect(classes).toContain('motion-safe:animate-spin');
    expect(classes).not.toContain('animate-spin');
  });
});
