import { TestBed } from '@angular/core/testing';

import { ANNOUNCE_DELAY_MS, LiveAnnouncer } from './live-announcer';

describe('LiveAnnouncer', () => {
  const regions = () => document.body.querySelectorAll('[data-live-announcer]');

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds one hidden polite region to <body> and writes the message after a short pause', () => {
    const announcer = TestBed.inject(LiveAnnouncer);
    announcer.announce('Orders');

    expect(regions().length).toBe(1);
    const region = regions()[0] as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.classList).toContain('sr-only');
    // Empty first, so the same text twice in a row is still announced.
    expect(region.textContent).toBe('');

    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(region.textContent).toBe('Orders');

    announcer.announce('Orders');
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(region.textContent).toBe('Orders');
    expect(regions().length).toBe(1);
  });

  it('only says the latest of quick successive messages', () => {
    const announcer = TestBed.inject(LiveAnnouncer);
    announcer.announce('Orders');
    announcer.announce('Reports');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(regions()[0].textContent).toBe('Reports');
  });

  it('removes its region when the app is torn down', () => {
    TestBed.inject(LiveAnnouncer).announce('Orders');
    expect(regions().length).toBe(1);
    TestBed.resetTestingModule();
    expect(regions().length).toBe(0);
  });
});
