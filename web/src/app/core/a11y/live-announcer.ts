import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';

/** How long the region stays empty before a message is written, so a repeat is announced too. */
export const ANNOUNCE_DELAY_MS = 100;

/**
 * The app's one polite live region for messages that have no place on the page, such as "Orders"
 * after a navigation. A visually hidden `<div aria-live="polite">` added to `<body>` on first use
 * (it must exist before its text changes, or screen readers miss the change). Pages keep their own
 * `role="status"` lines for results that belong to them.
 */
@Injectable({ providedIn: 'root' })
export class LiveAnnouncer {
  private readonly document = inject(DOCUMENT);
  private region: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer !== null) {
        clearTimeout(this.timer);
      }
      this.region?.remove();
      this.region = null;
    });
  }

  /** Says `message` once, politely (after what the screen reader is already saying). */
  announce(message: string): void {
    const region = this.ensureRegion();
    region.textContent = '';
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      region.textContent = message;
    }, ANNOUNCE_DELAY_MS);
  }

  /** The region's element (created when missing). */
  ensureRegion(): HTMLElement {
    if (this.region?.isConnected) {
      return this.region;
    }
    const region = this.document.createElement('div');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('data-live-announcer', '');
    region.className = 'sr-only';
    this.document.body.appendChild(region);
    this.region = region;
    return region;
  }
}
