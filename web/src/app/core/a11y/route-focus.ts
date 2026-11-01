import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  Injector,
  afterNextRender,
  inject,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, TitleStrategy } from '@angular/router';
import { filter } from 'rxjs';

import { LiveAnnouncer } from './live-announcer';

/**
 * After a navigation to another page (the path changed, not just the query: filters, paging and
 * tabs keep focus where it is), moves keyboard focus to the new page's `<h1>`, so keyboard and
 * screen-reader users start at the top of the new content instead of on a link that is gone; the
 * focused heading is what the screen reader reads. A page without an `<h1>` gets focus on `<main>`
 * and its title said once through {@link LiveAnnouncer} instead. The first page of a visit is left
 * alone: the browser announces it, and the skip link stays the first stop.
 */
@Injectable({ providedIn: 'root' })
export class RouteFocus {
  private readonly router = inject(Router);
  private readonly titleStrategy = inject(TitleStrategy);
  private readonly title = inject(Title);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private lastPath: string | null = null;
  private started = false;

  /** Starts following navigations (once; later calls do nothing). */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    // The live region must exist before its first message, or screen readers miss it.
    this.announcer.ensureRegion();
    const subscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.onNavigated(event.urlAfterRedirects));
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  private onNavigated(url: string): void {
    const path = url.split(/[?#]/, 1)[0];
    const previous = this.lastPath;
    this.lastPath = path;
    if (previous === null || previous === path) {
      return;
    }
    // Once the new page has rendered its heading.
    afterNextRender({ read: () => this.focusPage() }, { injector: this.injector });
  }

  private focusPage(): void {
    const main = this.document.querySelector('main');
    const heading = main?.querySelector('h1') ?? this.document.querySelector('h1');
    const target = heading ?? main;
    if (target) {
      if (!target.hasAttribute('tabindex')) {
        // Focusable by script only, never a Tab stop.
        target.setAttribute('tabindex', '-1');
      }
      target.focus();
    }
    if (!heading) {
      // Focus on <main> says little; name the page (once: a focused heading already does).
      const pageTitle = this.titleStrategy.buildTitle(this.router.routerState.snapshot);
      this.announcer.announce(pageTitle ?? this.title.getTitle());
    }
  }
}
